import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { mapCompanyUserRow, mapProfileRow } from './mappers'
import type { CompanyRole, CompanyUserRecord, ProfileRecord } from './types'

function db(client?: SupabaseClient) {
  return client ?? createAdminClient()
}

export async function findProfileByUserId(
  userId: string,
  client?: SupabaseClient,
): Promise<ProfileRecord | null> {
  const { data, error } = await db(client).from('profiles').select('*').eq('id', userId).maybeSingle()
  if (error) throw error
  if (!data) return null
  return mapProfileRow(data)
}

export async function findProfileByLegacyUserId(
  legacyUserId: string,
  client?: SupabaseClient,
): Promise<ProfileRecord | null> {
  const { data, error } = await db(client)
    .from('profiles')
    .select('*')
    .eq('legacy_user_id', legacyUserId)
    .maybeSingle()

  if (error) throw error
  if (!data) return null
  return mapProfileRow(data)
}

export async function upsertProfile(
  input: {
    userId: string
    fullName?: string | null
    phone?: string | null
    legacyUserId?: string | null
  },
  client?: SupabaseClient,
): Promise<ProfileRecord> {
  const { data, error } = await db(client)
    .from('profiles')
    .upsert(
      {
        id: input.userId,
        full_name: input.fullName ?? null,
        phone: input.phone ?? null,
        legacy_user_id: input.legacyUserId ?? null,
      },
      { onConflict: 'id' },
    )
    .select('*')
    .single()

  if (error) throw error
  return mapProfileRow(data)
}

export async function listCompanyUsers(
  companyId: string,
  client?: SupabaseClient,
): Promise<CompanyUserRecord[]> {
  const { data, error } = await db(client)
    .from('company_users')
    .select('*')
    .eq('company_id', companyId)
    .eq('is_active', true)

  if (error) throw error
  return (data ?? []).map(mapCompanyUserRow)
}

export async function listUserCompanies(
  userId: string,
  client?: SupabaseClient,
): Promise<CompanyUserRecord[]> {
  const { data, error } = await db(client)
    .from('company_users')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)

  if (error) throw error
  return (data ?? []).map(mapCompanyUserRow)
}

export async function addCompanyUser(
  input: {
    companyId: string
    userId: string
    role?: CompanyRole
  },
  client?: SupabaseClient,
): Promise<CompanyUserRecord> {
  const { data, error } = await db(client)
    .from('company_users')
    .upsert(
      {
        company_id: input.companyId,
        user_id: input.userId,
        role: input.role ?? 'ACCOUNTANT',
        is_active: true,
      },
      { onConflict: 'company_id,user_id' },
    )
    .select('*')
    .single()

  if (error) throw error
  return mapCompanyUserRow(data)
}

export async function getUserPreferences(
  userId: string,
  client?: SupabaseClient,
): Promise<Record<string, unknown>> {
  const { data, error } = await db(client)
    .from('user_preferences')
    .select('preferences')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw error
  return (data?.preferences as Record<string, unknown>) ?? {}
}

export async function updateUserPreferences(
  userId: string,
  preferences: Record<string, unknown>,
  client?: SupabaseClient,
): Promise<void> {
  const { error } = await db(client)
    .from('user_preferences')
    .upsert({ user_id: userId, preferences }, { onConflict: 'user_id' })

  if (error) throw error
}
