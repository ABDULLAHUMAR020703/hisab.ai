import 'server-only'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { findCompanyById } from '@/lib/db/company.repository'
import type { CompanyRole } from '@/lib/db/types'
import { TenantAccessError } from '@/lib/tenant-error'
import { getSupabaseAnonKey, getSupabaseUrl } from './env'
import { createAdminClient } from './admin'

export interface AppUser {
  id: string
  name: string | null
  email: string
  role: string
  companyId: string
  companyName: string
  avatarUrl: string | null
  isActive: boolean
}

function toCompanyRole(role: string | null | undefined): CompanyRole {
  if (role === 'ADMIN' || role === 'ACCOUNTANT' || role === 'OWNER' || role === 'MANAGER' || role === 'EMPLOYEE') {
    return role
  }
  return 'AUDITOR'
}

function publicRole(role: string | null | undefined): string {
  return role === 'AUDITOR' ? 'VIEWER' : role || 'ACCOUNTANT'
}

export function createPasswordAuthClient() {
  return createSupabaseClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

async function resolvePrimaryCompanyId(userId: string): Promise<string> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('company_users')
    .select('company_id, role, created_at')
    .eq('user_id', userId)
    .eq('is_active', true)
    .order('created_at', { ascending: true })

  if (error) throw error
  if (!data?.length) {
    throw new TenantAccessError('This account is not linked to a company. Register a new company or accept an invitation.')
  }

  const ownerMemberships = data.filter((row) => row.role === 'OWNER')
  if (ownerMemberships.length > 0) {
    return String(ownerMemberships[ownerMemberships.length - 1].company_id)
  }

  return String(data[data.length - 1].company_id)
}

export async function upsertProfileAndMembership(input: {
  userId: string
  email: string
  name?: string | null
  role?: string | null
  isActive?: boolean
  companyId: string
}) {
  const admin = createAdminClient()

  const { error: profileError } = await admin
    .from('profiles')
    .upsert(
      {
        id: input.userId,
        full_name: input.name ?? input.email.split('@')[0],
        is_active: input.isActive ?? true,
      },
      { onConflict: 'id' },
    )
  if (profileError) throw profileError

  const { error: membershipError } = await admin
    .from('company_users')
    .upsert(
      {
        company_id: input.companyId,
        user_id: input.userId,
        role: toCompanyRole(input.role),
        is_active: input.isActive ?? true,
      },
      { onConflict: 'company_id,user_id' },
    )
  if (membershipError) throw membershipError
}

export async function getAppUser(userId: string, email: string): Promise<AppUser> {
  const admin = createAdminClient()
  const companyId = await resolvePrimaryCompanyId(userId)

  const [{ data: profile, error: profileError }, { data: membership, error: membershipError }, company] =
    await Promise.all([
      admin.from('profiles').select('full_name, avatar_url, is_active').eq('id', userId).maybeSingle(),
      admin
        .from('company_users')
        .select('role, is_active')
        .eq('company_id', companyId)
        .eq('user_id', userId)
        .maybeSingle(),
      findCompanyById(companyId, admin),
    ])

  if (profileError) throw profileError
  if (membershipError) throw membershipError
  if (!membership) {
    throw new TenantAccessError('Company membership not found for this account.')
  }

  return {
    id: userId,
    name: (profile?.full_name as string | null | undefined) ?? email.split('@')[0],
    email,
    companyId,
    companyName: company?.companyName ?? 'Company',
    avatarUrl: (profile?.avatar_url as string | null | undefined) ?? null,
    role: publicRole((membership?.role as string | null | undefined) ?? 'ACCOUNTANT'),
    isActive: Boolean((profile?.is_active ?? true) && (membership?.is_active ?? true)),
  }
}

export async function listAppUsers(companyId: string): Promise<(AppUser & { createdAt: string })[]> {
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('company_users')
    .select('user_id, role, is_active, created_at, profiles(full_name, avatar_url, is_active)')
    .eq('company_id', companyId)
    .order('created_at', { ascending: true })

  if (error) throw error

  const company = await findCompanyById(companyId, admin)

  const users = await Promise.all(
    (data ?? []).map(async (row) => {
      const { data: authUser, error: authError } = await admin.auth.admin.getUserById(String(row.user_id))
      if (authError) throw authError

      const profile = row.profiles as {
        full_name?: string | null
        avatar_url?: string | null
        is_active?: boolean | null
      } | null
      const userEmail = authUser.user.email ?? ''

      return {
        id: String(row.user_id),
        name: profile?.full_name ?? userEmail.split('@')[0],
        email: userEmail,
        companyId,
        companyName: company?.companyName ?? 'Company',
        avatarUrl: profile?.avatar_url ?? null,
        role: publicRole(row.role as string | null),
        isActive: Boolean((row.is_active ?? true) && (profile?.is_active ?? true)),
        createdAt: String(row.created_at),
      }
    }),
  )

  return users.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
}

export async function createAppUser(input: {
  email: string
  password: string
  name?: string | null
  role?: string | null
  companyId: string
}): Promise<AppUser & { createdAt: string }> {
  // Flow B (invite): joins an existing tenant. Never creates a new company.
  const admin = createAdminClient()
  const { data, error } = await admin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    user_metadata: {
      full_name: input.name ?? input.email.split('@')[0],
      role: publicRole(input.role),
    },
  })
  if (error) throw error
  if (!data.user.email) throw new Error('User email is missing')

  await upsertProfileAndMembership({
    userId: data.user.id,
    email: data.user.email,
    name: input.name ?? null,
    role: input.role ?? 'ACCOUNTANT',
    companyId: input.companyId,
    isActive: true,
  })

  const user = await getAppUser(data.user.id, data.user.email)
  return { ...user, createdAt: new Date().toISOString() }
}

export async function updateAppUser(
  userId: string,
  companyId: string,
  input: { name?: string | null; role?: string | null; isActive?: boolean | null; password?: string | null },
): Promise<AppUser> {
  const admin = createAdminClient()
  const { data: authUser, error: authError } = await admin.auth.admin.getUserById(userId)
  if (authError) throw authError
  if (!authUser.user.email) throw new Error('User email is missing')

  const updateData: Parameters<typeof admin.auth.admin.updateUserById>[1] = {
    user_metadata: {
      ...(authUser.user.user_metadata ?? {}),
      full_name: input.name ?? authUser.user.user_metadata?.full_name,
      role: publicRole(input.role ?? authUser.user.user_metadata?.role),
    },
  }
  if (input.password) updateData.password = input.password

  const { error: updateError } = await admin.auth.admin.updateUserById(userId, updateData)
  if (updateError) throw updateError

  await upsertProfileAndMembership({
    userId,
    email: authUser.user.email,
    name: input.name ?? authUser.user.user_metadata?.full_name ?? null,
    role: input.role ?? authUser.user.user_metadata?.role ?? 'ACCOUNTANT',
    isActive: input.isActive ?? true,
    companyId,
  })

  return getAppUser(userId, authUser.user.email)
}

export async function deleteAppUser(userId: string) {
  const admin = createAdminClient()
  const { error } = await admin.auth.admin.deleteUser(userId)
  if (error) throw error
}

export async function userHasCompanyMembership(userId: string): Promise<boolean> {
  const admin = createAdminClient()
  const { count, error } = await admin
    .from('company_users')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('is_active', true)

  if (error) throw error
  return (count ?? 0) > 0
}
