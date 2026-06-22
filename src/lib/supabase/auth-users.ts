import 'server-only'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { DEMO_ACCOUNTANT_EMAIL, DEMO_ADMIN_EMAIL } from '@/lib/brand'
import { getDefaultCompanyId } from '@/lib/db/company.repository'
import type { CompanyRole } from '@/lib/db/types'
import { getSupabaseAnonKey, getSupabaseUrl } from './env'
import { createAdminClient } from './admin'

export interface AppUser {
  id: string
  name: string | null
  email: string
  role: string
  isActive: boolean
}

const DEMO_USERS = [
  { email: DEMO_ADMIN_EMAIL, name: 'System Administrator', role: 'ADMIN', password: 'admin123' },
  { email: DEMO_ACCOUNTANT_EMAIL, name: 'Senior Accountant', role: 'ACCOUNTANT', password: 'accountant123' },
] as const

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

async function findAuthUserByEmail(email: string) {
  const admin = createAdminClient()
  let page = 1

  while (page < 20) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 })
    if (error) throw error

    const user = data.users.find((candidate) => candidate.email?.toLowerCase() === email.toLowerCase())
    if (user) return user
    if (data.users.length < 100) return null
    page += 1
  }

  return null
}

export async function ensureSupabaseUser(input: {
  email: string
  password: string
  name?: string | null
  role?: string | null
}) {
  const admin = createAdminClient()
  const existing = await findAuthUserByEmail(input.email)
  let userId = existing?.id

  if (!existing) {
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
    userId = data.user.id
  } else if (input.password && input.email.endsWith('@hisab.ai')) {
    const { error } = await admin.auth.admin.updateUserById(existing.id, {
      password: input.password,
      user_metadata: {
        ...(existing.user_metadata ?? {}),
        full_name: input.name ?? existing.user_metadata?.full_name,
        role: publicRole(input.role ?? existing.user_metadata?.role),
      },
    })
    if (error) throw error
  }

  if (!userId) throw new Error(`Could not resolve Supabase user ${input.email}`)

  await upsertProfileAndMembership({
    userId,
    email: input.email,
    name: input.name ?? null,
    role: input.role ?? 'ACCOUNTANT',
    isActive: true,
  })

  return userId
}

export async function ensureDemoSupabaseUsers() {
  for (const user of DEMO_USERS) {
    await ensureSupabaseUser(user)
  }
}

export async function upsertProfileAndMembership(input: {
  userId: string
  email: string
  name?: string | null
  role?: string | null
  isActive?: boolean
}) {
  const admin = createAdminClient()
  const companyId = await getDefaultCompanyId(admin)

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
        company_id: companyId,
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
  const companyId = await getDefaultCompanyId(admin)

  const [{ data: profile, error: profileError }, { data: membership, error: membershipError }] = await Promise.all([
    admin.from('profiles').select('full_name, is_active').eq('id', userId).maybeSingle(),
    admin
      .from('company_users')
      .select('role, is_active')
      .eq('company_id', companyId)
      .eq('user_id', userId)
      .maybeSingle(),
  ])

  if (profileError) throw profileError
  if (membershipError) throw membershipError

  return {
    id: userId,
    name: (profile?.full_name as string | null | undefined) ?? email.split('@')[0],
    email,
    role: publicRole((membership?.role as string | null | undefined) ?? 'ACCOUNTANT'),
    isActive: Boolean((profile?.is_active ?? true) && (membership?.is_active ?? true)),
  }
}

export async function listAppUsers(): Promise<(AppUser & { createdAt: string })[]> {
  const admin = createAdminClient()
  const companyId = await getDefaultCompanyId(admin)

  const { data, error } = await admin
    .from('company_users')
    .select('user_id, role, is_active, created_at, profiles(full_name, is_active)')
    .eq('company_id', companyId)
    .order('created_at', { ascending: true })

  if (error) throw error

  const users = await Promise.all(
    (data ?? []).map(async (row) => {
      const { data: authUser, error: authError } = await admin.auth.admin.getUserById(String(row.user_id))
      if (authError) throw authError

      const profile = row.profiles as { full_name?: string | null; is_active?: boolean | null } | null
      const email = authUser.user.email ?? ''

      return {
        id: String(row.user_id),
        name: profile?.full_name ?? email.split('@')[0],
        email,
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
}): Promise<AppUser & { createdAt: string }> {
  const userId = await ensureSupabaseUser(input)
  const user = await getAppUser(userId, input.email)
  return { ...user, createdAt: new Date().toISOString() }
}

export async function updateAppUser(
  userId: string,
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
  })

  return getAppUser(userId, authUser.user.email)
}

export async function deleteAppUser(userId: string) {
  const admin = createAdminClient()
  const { error } = await admin.auth.admin.deleteUser(userId)
  if (error) throw error
}
