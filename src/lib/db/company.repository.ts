import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { DEFAULT_COMPANY_ID } from '@/lib/supabase/env'
import { mapCompanyRow } from './mappers'
import type { CompanyRecord } from './types'

function db(client?: SupabaseClient) {
  return client ?? createAdminClient()
}

export async function findCompanyById(
  companyId: string,
  client?: SupabaseClient,
): Promise<CompanyRecord | null> {
  const { data, error } = await db(client)
    .from('companies')
    .select('*')
    .eq('id', companyId)
    .maybeSingle()

  if (error) throw error
  if (!data) return null
  return mapCompanyRow(data)
}

export async function findCompanyBySlug(
  slug: string,
  client?: SupabaseClient,
): Promise<CompanyRecord | null> {
  const { data, error } = await db(client).from('companies').select('*').eq('slug', slug).maybeSingle()
  if (error) throw error
  if (!data) return null
  return mapCompanyRow(data)
}

/** First active company, or seeded default — mirrors single-tenant `findFirst()` today. */
export async function getDefaultCompanyId(client?: SupabaseClient): Promise<string> {
  const { data, error } = await db(client)
    .from('companies')
    .select('id')
    .eq('is_active', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return data?.id ?? DEFAULT_COMPANY_ID
}

export async function listCompanies(client?: SupabaseClient): Promise<CompanyRecord[]> {
  const { data, error } = await db(client)
    .from('companies')
    .select('*')
    .eq('is_active', true)
    .order('company_name')

  if (error) throw error
  return (data ?? []).map(mapCompanyRow)
}

export async function createCompany(
  input: {
    slug: string
    companyName: string
    legalName?: string | null
    country?: string
    currency?: string
  },
  client?: SupabaseClient,
): Promise<CompanyRecord> {
  const supabase = db(client)
  const { data: company, error: companyError } = await supabase
    .from('companies')
    .insert({
      slug: input.slug,
      company_name: input.companyName,
      legal_name: input.legalName ?? null,
      country: input.country ?? 'Saudi Arabia',
      currency: input.currency ?? 'SAR',
    })
    .select('*')
    .single()

  if (companyError) throw companyError

  const companyId = company.id as string
  const { error: settingsError } = await supabase.from('company_settings').insert({ company_id: companyId })
  if (settingsError) throw settingsError

  const { error: zatcaError } = await supabase.from('company_zatca_settings').insert({ company_id: companyId })
  if (zatcaError) throw zatcaError

  const { error: subError } = await supabase
    .from('company_subscriptions')
    .insert({ company_id: companyId, plan: 'FREE', status: 'TRIAL' })
  if (subError) throw subError

  return mapCompanyRow(company)
}
