/**
 * Split Mohsin into an isolated production tenant (Node alternative to 020 migration).
 *
 * Usage (from repo root, with .env loaded):
 *   node scripts/split-mohsin-tenant.mjs
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 */

import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'crypto'

const DEV_COMPANY_ID = '00000000-0000-4000-8000-000000000001'
const MOHSIN_EMAIL = 'mohsin.javaid@netkom.com.pk'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !key) {
  console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const db = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

function uniqueSlug(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`
}

function pickMaster(source) {
  return {
    company_name: source.company_name,
    legal_name: source.legal_name,
    tax_id: source.tax_id,
    commercial_registration: source.commercial_registration,
    address: source.address,
    street_address: source.street_address,
    building_number: source.building_number,
    district: source.district,
    city: source.city,
    postal_code: source.postal_code,
    country: source.country ?? 'Saudi Arabia',
    phone: source.phone,
    email: source.email,
    currency: source.currency ?? 'SAR',
    fiscal_year_start: source.fiscal_year_start ?? '01-01',
    website: source.website,
    is_active: true,
  }
}

async function findUserId(email) {
  const { data, error } = await db.auth.admin.listUsers({ perPage: 1000 })
  if (error) throw error
  return data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id ?? null
}

async function main() {
  const mohsinId = await findUserId(MOHSIN_EMAIL)
  if (!mohsinId) {
    console.log(`User ${MOHSIN_EMAIL} not found`)
    return
  }

  const { data: existingOwner } = await db
    .from('company_users')
    .select('company_id')
    .eq('user_id', mohsinId)
    .eq('role', 'OWNER')
    .eq('is_active', true)
    .neq('company_id', DEV_COMPANY_ID)
    .limit(1)
    .maybeSingle()

  if (existingOwner?.company_id) {
    console.log(`Already split — Mohsin owns tenant ${existingOwner.company_id}`)
    return
  }

  const { data: devMembership } = await db
    .from('company_users')
    .select('company_id')
    .eq('user_id', mohsinId)
    .eq('company_id', DEV_COMPANY_ID)
    .eq('is_active', true)
    .maybeSingle()

  if (!devMembership) {
    console.log(`Mohsin is not on dev company ${DEV_COMPANY_ID} — review manually`)
    return
  }

  const [{ data: sourceCompany, error: sourceError }, { data: sourceSettings }, { data: sourceZatca }] =
    await Promise.all([
      db.from('companies').select('*').eq('id', DEV_COMPANY_ID).single(),
      db.from('company_settings').select('*').eq('company_id', DEV_COMPANY_ID).maybeSingle(),
      db.from('company_zatca_settings').select('zatca_business_category').eq('company_id', DEV_COMPANY_ID).maybeSingle(),
    ])

  if (sourceError) throw sourceError

  const { data: company, error: createError } = await db
    .from('companies')
    .insert({ slug: uniqueSlug('netkom-production'), ...pickMaster(sourceCompany) })
    .select('*')
    .single()

  if (createError) throw createError

  const companyId = company.id

  await db.from('company_settings').insert({
    company_id: companyId,
    locale: sourceSettings?.locale ?? 'ar-SA',
    timezone: sourceSettings?.timezone ?? 'Asia/Riyadh',
    invoice_prefix: sourceSettings?.invoice_prefix ?? 'INV-',
  })

  await db.from('company_zatca_settings').insert({
    company_id: companyId,
    zatca_enabled: false,
    zatca_connected: false,
    zatca_business_category: sourceZatca?.zatca_business_category ?? null,
  })

  await db.from('company_subscriptions').insert({ company_id: companyId, plan: 'FREE', status: 'TRIAL' })

  await db.from('company_users').delete().eq('user_id', mohsinId).eq('company_id', DEV_COMPANY_ID)

  await db.from('company_users').upsert({
    company_id: companyId,
    user_id: mohsinId,
    role: 'OWNER',
    is_active: true,
  }, { onConflict: 'company_id,user_id' })

  console.log('Split complete')
  console.log({ devCompanyId: DEV_COMPANY_ID, mohsinCompanyId: companyId, companyName: company.company_name })
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
