import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { DEFAULT_CURRENCY, normalizeCurrency } from '@/lib/currency/constants'
import { createAdminClient } from '@/lib/supabase/admin'
import { DEFAULT_COMPANY_ID } from '@/lib/supabase/env'
import { mapCompanyRow } from './mappers'
import type { CompanyRecord } from './types'

function db(client?: SupabaseClient) {
  return client ?? createAdminClient()
}

export function uniqueCompanySlug(prefix: string): string {
  const base = prefix
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'company'
  return `${base}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function pickCompanyMasterFields(source: Record<string, unknown>): Record<string, unknown> {
  return {
    company_name: source.company_name,
    legal_name: source.legal_name ?? null,
    tax_id: source.tax_id ?? null,
    commercial_registration: source.commercial_registration ?? null,
    address: source.address ?? null,
    street_address: source.street_address ?? null,
    building_number: source.building_number ?? null,
    district: source.district ?? null,
    city: source.city ?? null,
    postal_code: source.postal_code ?? null,
    country: source.country ?? 'Saudi Arabia',
    phone: source.phone ?? null,
    email: source.email ?? null,
    currency: normalizeCurrency(String(source.currency ?? DEFAULT_CURRENCY)),
    fiscal_year_start: source.fiscal_year_start ?? '01-01',
    website: source.website ?? null,
    is_active: true,
  }
}

async function insertTenantShell(
  supabase: SupabaseClient,
  companyId: string,
  input?: {
    locale?: string
    timezone?: string
    invoicePrefix?: string
    zatcaBusinessCategory?: string | null
  },
) {
  const { error: settingsError } = await supabase.from('company_settings').insert({
    company_id: companyId,
    locale: input?.locale ?? 'ar-SA',
    timezone: input?.timezone ?? 'Asia/Riyadh',
    invoice_prefix: input?.invoicePrefix ?? 'INV-',
  })
  if (settingsError) throw settingsError

  const { error: zatcaError } = await supabase.from('company_zatca_settings').insert({
    company_id: companyId,
    zatca_enabled: false,
    zatca_connected: false,
    zatca_business_category: input?.zatcaBusinessCategory ?? null,
  })
  if (zatcaError) throw zatcaError

  const { error: subError } = await supabase
    .from('company_subscriptions')
    .insert({ company_id: companyId, plan: 'FREE', status: 'TRIAL' })
  if (subError) throw subError
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

/** Seed/QA only — never used for authenticated tenant resolution. */
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

/**
 * Create a brand-new tenant. Company names are not unique identifiers — isolation is always by `companies.id`.
 * Registration never looks up an existing company by name or slug prefix.
 */
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
      currency: normalizeCurrency(input.currency ?? DEFAULT_CURRENCY),
    })
    .select('*')
    .single()

  if (companyError) throw companyError

  await insertTenantShell(supabase, company.id as string)
  return mapCompanyRow(company)
}

/**
 * Create a new isolated tenant by copying company master data from an existing company.
 * Does not copy accounting records, ZATCA credentials, branding assets, or audit logs.
 */
export async function createIsolatedTenantFromMaster(
  input: {
    sourceCompanyId: string
    slugPrefix: string
  },
  client?: SupabaseClient,
): Promise<CompanyRecord> {
  const supabase = db(client)

  const [{ data: sourceCompany, error: sourceError }, { data: sourceSettings }, { data: sourceZatca }] =
    await Promise.all([
      supabase.from('companies').select('*').eq('id', input.sourceCompanyId).single(),
      supabase.from('company_settings').select('*').eq('company_id', input.sourceCompanyId).maybeSingle(),
      supabase
        .from('company_zatca_settings')
        .select('zatca_business_category')
        .eq('company_id', input.sourceCompanyId)
        .maybeSingle(),
    ])

  if (sourceError) throw sourceError

  const { data: company, error: companyError } = await supabase
    .from('companies')
    .insert({
      slug: uniqueCompanySlug(input.slugPrefix),
      ...pickCompanyMasterFields(sourceCompany),
    })
    .select('*')
    .single()

  if (companyError) throw companyError

  await insertTenantShell(supabase, company.id as string, {
    locale: (sourceSettings?.locale as string | undefined) ?? 'ar-SA',
    timezone: (sourceSettings?.timezone as string | undefined) ?? 'Asia/Riyadh',
    invoicePrefix: (sourceSettings?.invoice_prefix as string | undefined) ?? 'INV-',
    zatcaBusinessCategory: (sourceZatca?.zatca_business_category as string | null | undefined) ?? null,
  })

  return mapCompanyRow(company)
}

/**
 * Move a user off a shared tenant onto a newly provisioned isolated tenant (OWNER).
 * Idempotent when the user already owns a different company.
 */
export async function reassignUserToIsolatedTenant(
  input: {
    userId: string
    fromCompanyId: string
    slugPrefix: string
  },
  client?: SupabaseClient,
): Promise<{ companyId: string; created: boolean }> {
  const supabase = db(client)

  const { data: existingOwner, error: ownerError } = await supabase
    .from('company_users')
    .select('company_id')
    .eq('user_id', input.userId)
    .eq('role', 'OWNER')
    .eq('is_active', true)
    .neq('company_id', input.fromCompanyId)
    .limit(1)
    .maybeSingle()

  if (ownerError) throw ownerError
  if (existingOwner?.company_id) {
    return { companyId: String(existingOwner.company_id), created: false }
  }

  const company = await createIsolatedTenantFromMaster(
    {
      sourceCompanyId: input.fromCompanyId,
      slugPrefix: input.slugPrefix,
    },
    supabase,
  )

  const { error: removeError } = await supabase
    .from('company_users')
    .delete()
    .eq('user_id', input.userId)
    .eq('company_id', input.fromCompanyId)

  if (removeError) throw removeError

  const { error: membershipError } = await supabase.from('company_users').upsert(
    {
      company_id: company.id,
      user_id: input.userId,
      role: 'OWNER',
      is_active: true,
    },
    { onConflict: 'company_id,user_id' },
  )

  if (membershipError) throw membershipError

  return { companyId: company.id, created: true }
}

