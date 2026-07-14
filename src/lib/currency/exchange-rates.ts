import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCompanyId } from '@/lib/tenant'
import { getCompanyPrimaryCurrency } from './company'

export type ExchangeRateSource = 'MANUAL' | 'AUTO' | 'OVERRIDE'

export async function getExchangeRateAtDate(
  fromCurrency: string,
  toCurrency: string,
  asOf: Date,
  companyId?: string,
): Promise<number> {
  if (fromCurrency === toCurrency) return 1

  const cid = companyId ?? await resolveCompanyId()
  const client = createAdminClient()

  const { data, error } = await client
    .from('exchange_rates')
    .select('rate, is_manual_override')
    .eq('company_id', cid)
    .eq('from_currency', fromCurrency)
    .eq('to_currency', toCurrency)
    .lte('effective_date', asOf.toISOString())
    .order('is_manual_override', { ascending: false })
    .order('effective_date', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  if (data) return Number(data.rate)

  const { data: inverse } = await client
    .from('exchange_rates')
    .select('rate')
    .eq('company_id', cid)
    .eq('from_currency', toCurrency)
    .eq('to_currency', fromCurrency)
    .lte('effective_date', asOf.toISOString())
    .order('effective_date', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (inverse && Number(inverse.rate) !== 0) return 1 / Number(inverse.rate)

  return getExchangeRate(fromCurrency, toCurrency, cid)
}

export async function getExchangeRate(
  fromCurrency: string,
  toCurrency: string,
  companyId?: string,
): Promise<number> {
  return getExchangeRateAtDate(fromCurrency, toCurrency, new Date(), companyId)
}

export async function convertAmount(
  amount: number,
  fromCurrency: string,
  toCurrency?: string,
  companyId?: string,
  asOf?: Date,
): Promise<{ amount: number; rate: number; currency: string }> {
  const target = toCurrency ?? await getCompanyPrimaryCurrency()
  const rate = await getExchangeRateAtDate(fromCurrency, target, asOf ?? new Date(), companyId)
  return {
    amount: amount * rate,
    rate,
    currency: target,
  }
}

/** Automatic rate lookup — uses latest stored rate or fetches when auto_fetch enabled. */
export async function lookupExchangeRate(input: {
  fromCurrency: string
  toCurrency: string
  asOf?: Date
  companyId?: string
}): Promise<{ rate: number; source: ExchangeRateSource }> {
  const cid = input.companyId ?? await resolveCompanyId()
  const asOf = input.asOf ?? new Date()
  const client = createAdminClient()

  const { data: manual } = await client
    .from('exchange_rates')
    .select('rate, source, is_manual_override')
    .eq('company_id', cid)
    .eq('from_currency', input.fromCurrency)
    .eq('to_currency', input.toCurrency)
    .lte('effective_date', asOf.toISOString())
    .order('is_manual_override', { ascending: false })
    .order('effective_date', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (manual) {
    return {
      rate: Number(manual.rate),
      source: manual.is_manual_override ? 'OVERRIDE' : (manual.source as ExchangeRateSource) ?? 'MANUAL',
    }
  }

  const settings = await (async () => {
    const { data } = await client
      .from('currency_settings')
      .select('auto_fetch_rates')
      .eq('company_id', cid)
      .maybeSingle()
    return data
  })()

  if (settings?.auto_fetch_rates) {
    const rate = await fetchExternalRateStub(input.fromCurrency, input.toCurrency)
    if (rate) {
      await upsertExchangeRate({
        fromCurrency: input.fromCurrency,
        toCurrency: input.toCurrency,
        rate,
        effectiveDate: asOf,
        source: 'AUTO',
        companyId: cid,
      })
      return { rate, source: 'AUTO' }
    }
  }

  const rate = await getExchangeRateAtDate(input.fromCurrency, input.toCurrency, asOf, cid)
  return { rate, source: 'MANUAL' }
}

async function fetchExternalRateStub(from: string, to: string): Promise<number | null> {
  if (from === to) return 1
  return null
}

export async function listExchangeRates(companyId?: string, options?: {
  fromCurrency?: string
  toCurrency?: string
  limit?: number
}) {
  const cid = companyId ?? await resolveCompanyId()
  const client = createAdminClient()
  let query = client
    .from('exchange_rates')
    .select('*')
    .eq('company_id', cid)
    .order('effective_date', { ascending: false })

  if (options?.fromCurrency) query = query.eq('from_currency', options.fromCurrency)
  if (options?.toCurrency) query = query.eq('to_currency', options.toCurrency)
  if (options?.limit) query = query.limit(options.limit)

  const { data, error } = await query
  if (error) throw error
  return data ?? []
}

export async function upsertExchangeRate(input: {
  fromCurrency: string
  toCurrency: string
  rate: number
  effectiveDate?: Date
  companyId?: string
  source?: ExchangeRateSource
  isManualOverride?: boolean
  notes?: string
  createdById?: string | null
}) {
  const cid = input.companyId ?? await resolveCompanyId()
  const client = createAdminClient()
  const { data, error } = await client
    .from('exchange_rates')
    .upsert({
      company_id: cid,
      from_currency: input.fromCurrency,
      to_currency: input.toCurrency,
      rate: input.rate,
      effective_date: (input.effectiveDate ?? new Date()).toISOString(),
      source: input.isManualOverride ? 'OVERRIDE' : (input.source ?? 'MANUAL'),
      is_manual_override: input.isManualOverride ?? false,
      notes: input.notes ?? null,
      created_by_id: input.createdById ?? null,
    }, { onConflict: 'company_id,from_currency,to_currency,effective_date' })
    .select('*')
    .single()

  if (error) throw error
  return data
}
