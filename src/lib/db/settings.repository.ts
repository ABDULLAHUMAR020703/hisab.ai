import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { getDefaultCompanyId } from './company.repository'
import { mapCompanySettingsRows } from './mappers'
import type { CompanySettingsRecord, CompanySettingsUpdateInput } from './types'

function db(client?: SupabaseClient) {
  return client ?? createAdminClient()
}

async function loadCompanyBundle(companyId: string, client?: SupabaseClient) {
  const supabase = db(client)
  const [companyRes, settingsRes, zatcaRes] = await Promise.all([
    supabase.from('companies').select('*').eq('id', companyId).maybeSingle(),
    supabase.from('company_settings').select('*').eq('company_id', companyId).maybeSingle(),
    supabase.from('company_zatca_settings').select('*').eq('company_id', companyId).maybeSingle(),
  ])

  if (companyRes.error) throw companyRes.error
  if (settingsRes.error) throw settingsRes.error
  if (zatcaRes.error) throw zatcaRes.error
  if (!companyRes.data) return null

  return mapCompanySettingsRows(companyRes.data, settingsRes.data, zatcaRes.data)
}

/** Mirrors `prisma.companySettings.findFirst()`. */
export async function findFirstCompanySettings(
  companyId?: string,
  client?: SupabaseClient,
): Promise<CompanySettingsRecord | null> {
  const id = companyId ?? (await getDefaultCompanyId(client))
  return loadCompanyBundle(id, client)
}

/** Mirrors `prisma.companySettings.create()` with defaults. */
export async function createCompanySettings(
  input: CompanySettingsUpdateInput & { companyName: string },
  client?: SupabaseClient,
): Promise<CompanySettingsRecord> {
  const slug =
    input.companyName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'company'

  const supabase = db(client)
  const { data: company, error } = await supabase
    .from('companies')
    .insert({
      slug: `${slug}-${Date.now().toString(36)}`,
      company_name: input.companyName,
      legal_name: input.legalName ?? null,
      tax_id: input.taxId ?? null,
      commercial_registration: input.commercialRegistration ?? null,
      address: input.address ?? null,
      street_address: input.streetAddress ?? null,
      building_number: input.buildingNumber ?? null,
      district: input.district ?? null,
      city: input.city ?? null,
      postal_code: input.postalCode ?? null,
      country: input.country ?? 'Saudi Arabia',
      phone: input.phone ?? null,
      email: input.email ?? null,
      currency: input.currency ?? 'SAR',
      fiscal_year_start: input.fiscalYearStart ?? '01-01',
    })
    .select('*')
    .single()

  if (error) throw error

  const companyId = company.id as string
  await supabase.from('company_settings').insert({ company_id: companyId })
  await supabase.from('company_zatca_settings').insert({
    company_id: companyId,
    zatca_enabled: input.zatcaEnabled ?? false,
    zatca_connected: input.zatcaConnected ?? false,
    zatca_environment: input.zatcaEnvironment ?? 'SANDBOX',
    zatca_egs_unit_id: input.zatcaEgsUnitId ?? null,
    zatca_business_category: input.zatcaBusinessCategory ?? null,
  })
  await supabase.from('company_subscriptions').insert({ company_id: companyId })

  return (await loadCompanyBundle(companyId, client))!
}

/** Mirrors `prisma.companySettings.update()`. */
export async function updateCompanySettings(
  companyId: string,
  input: CompanySettingsUpdateInput,
  client?: SupabaseClient,
): Promise<CompanySettingsRecord> {
  const supabase = db(client)

  const companyPatch: Record<string, unknown> = {}
  if (input.companyName !== undefined) companyPatch.company_name = input.companyName
  if (input.legalName !== undefined) companyPatch.legal_name = input.legalName
  if (input.taxId !== undefined) companyPatch.tax_id = input.taxId
  if (input.commercialRegistration !== undefined) {
    companyPatch.commercial_registration = input.commercialRegistration
  }
  if (input.address !== undefined) companyPatch.address = input.address
  if (input.streetAddress !== undefined) companyPatch.street_address = input.streetAddress
  if (input.buildingNumber !== undefined) companyPatch.building_number = input.buildingNumber
  if (input.district !== undefined) companyPatch.district = input.district
  if (input.city !== undefined) companyPatch.city = input.city
  if (input.postalCode !== undefined) companyPatch.postal_code = input.postalCode
  if (input.country !== undefined) companyPatch.country = input.country
  if (input.phone !== undefined) companyPatch.phone = input.phone
  if (input.email !== undefined) companyPatch.email = input.email
  if (input.website !== undefined) companyPatch.website = input.website
  if (input.logoUrl !== undefined) companyPatch.logo_url = input.logoUrl
  if (input.logoStoragePath !== undefined) companyPatch.logo_storage_path = input.logoStoragePath
  if (input.logoUploadedAt !== undefined) {
    companyPatch.logo_uploaded_at = input.logoUploadedAt
      ? input.logoUploadedAt.toISOString()
      : null
  }
  if (input.currency !== undefined) companyPatch.currency = input.currency
  if (input.fiscalYearStart !== undefined) companyPatch.fiscal_year_start = input.fiscalYearStart

  if (Object.keys(companyPatch).length > 0) {
    const { error } = await supabase.from('companies').update(companyPatch).eq('id', companyId)
    if (error) throw error
  }

  const zatcaPatch: Record<string, unknown> = {}
  if (input.zatcaEnabled !== undefined) zatcaPatch.zatca_enabled = input.zatcaEnabled
  if (input.zatcaConnected !== undefined) zatcaPatch.zatca_connected = input.zatcaConnected
  if (input.zatcaConnectedAt !== undefined) zatcaPatch.zatca_connected_at = input.zatcaConnectedAt
  if (input.zatcaEnvironment !== undefined) zatcaPatch.zatca_environment = input.zatcaEnvironment
  if (input.zatcaEgsUnitId !== undefined) zatcaPatch.zatca_egs_unit_id = input.zatcaEgsUnitId
  if (input.zatcaDeviceIdentifier !== undefined) {
    zatcaPatch.zatca_device_identifier = input.zatcaDeviceIdentifier
  }
  if (input.zatcaEgsSerialNumber !== undefined) {
    zatcaPatch.zatca_egs_serial_number = input.zatcaEgsSerialNumber
  }
  if (input.zatcaBusinessCategory !== undefined) {
    zatcaPatch.zatca_business_category = input.zatcaBusinessCategory
  }

  if (Object.keys(zatcaPatch).length > 0) {
    const { error } = await supabase
      .from('company_zatca_settings')
      .update(zatcaPatch)
      .eq('company_id', companyId)
    if (error) throw error
  }

  return (await loadCompanyBundle(companyId, client))!
}

/** Upsert pattern used by `/api/settings` PUT. */
export async function upsertCompanySettings(
  input: CompanySettingsUpdateInput & { companyName?: string },
  client?: SupabaseClient,
): Promise<CompanySettingsRecord> {
  const existing = await findFirstCompanySettings(undefined, client)
  if (!existing) {
    return createCompanySettings({
      companyName: input.companyName ?? 'NETKOM COMPANY FOR COMMUNICATION',
      ...input,
    }, client)
  }
  return updateCompanySettings(existing.id, input, client)
}
