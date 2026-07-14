import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCompanyId } from '@/lib/tenant'
import { getCompanyPrimaryCurrency } from './company'
import { getExchangeRateAtDate } from './exchange-rates'
import { buildFxAmounts, type FxAmounts } from './fx-conversion'

export interface CurrencyRoleContext {
  baseCurrency: string
  reportingCurrency: string
}

export async function getCurrencyRoles(companyId?: string): Promise<CurrencyRoleContext> {
  const cid = companyId ?? await resolveCompanyId()
  const client = createAdminClient()

  const { data: company, error } = await client
    .from('companies')
    .select('currency, reporting_currency')
    .eq('id', cid)
    .single()

  if (error) throw error

  const baseCurrency = String(company?.currency ?? await getCompanyPrimaryCurrency())
  let reportingCurrency = String(company?.reporting_currency ?? baseCurrency)

  if (!company?.reporting_currency) {
    const { data: reportingRow } = await client
      .from('company_currencies')
      .select('code')
      .eq('company_id', cid)
      .eq('is_reporting', true)
      .limit(1)
      .maybeSingle()
    if (reportingRow?.code) reportingCurrency = String(reportingRow.code)
  }

  return { baseCurrency, reportingCurrency }
}

export async function resolveFxAmounts(input: {
  debit?: number
  credit?: number
  transactionCurrency: string
  entryDate: Date
  companyId?: string
  exchangeRateOverride?: number | null
}): Promise<FxAmounts> {
  const companyId = input.companyId ?? await resolveCompanyId()
  const roles = await getCurrencyRoles(companyId)
  const txnCurrency = input.transactionCurrency.toUpperCase()

  const baseRate = input.exchangeRateOverride ?? await getExchangeRateAtDate(
    txnCurrency,
    roles.baseCurrency,
    input.entryDate,
    companyId,
  )

  const reportingRate = txnCurrency === roles.reportingCurrency
    ? 1
    : await getExchangeRateAtDate(txnCurrency, roles.reportingCurrency, input.entryDate, companyId)

  return buildFxAmounts({
    debit: input.debit,
    credit: input.credit,
    transactionCurrency: txnCurrency,
    baseCurrency: roles.baseCurrency,
    reportingCurrency: roles.reportingCurrency,
    exchangeRate: baseRate,
    reportingExchangeRate: reportingRate,
  })
}

export interface CurrencySettings {
  companyId: string
  realizedGainAccountId: string | null
  realizedLossAccountId: string | null
  unrealizedGainAccountId: string | null
  unrealizedLossAccountId: string | null
  autoFetchRates: boolean
}

export async function getCurrencySettings(companyId?: string): Promise<CurrencySettings | null> {
  const cid = companyId ?? await resolveCompanyId()
  const client = createAdminClient()
  const { data, error } = await client
    .from('currency_settings')
    .select('*')
    .eq('company_id', cid)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  return {
    companyId: cid,
    realizedGainAccountId: data.realized_gain_account_id as string | null,
    realizedLossAccountId: data.realized_loss_account_id as string | null,
    unrealizedGainAccountId: data.unrealized_gain_account_id as string | null,
    unrealizedLossAccountId: data.unrealized_loss_account_id as string | null,
    autoFetchRates: Boolean(data.auto_fetch_rates),
  }
}

export async function upsertCurrencySettings(
  patch: Partial<Omit<CurrencySettings, 'companyId'>>,
  companyId?: string,
): Promise<CurrencySettings> {
  const cid = companyId ?? await resolveCompanyId()
  const client = createAdminClient()
  const { data, error } = await client
    .from('currency_settings')
    .upsert({
      company_id: cid,
      realized_gain_account_id: patch.realizedGainAccountId,
      realized_loss_account_id: patch.realizedLossAccountId,
      unrealized_gain_account_id: patch.unrealizedGainAccountId,
      unrealized_loss_account_id: patch.unrealizedLossAccountId,
      auto_fetch_rates: patch.autoFetchRates,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'company_id' })
    .select('*')
    .single()

  if (error) throw error
  return {
    companyId: cid,
    realizedGainAccountId: data.realized_gain_account_id as string | null,
    realizedLossAccountId: data.realized_loss_account_id as string | null,
    unrealizedGainAccountId: data.unrealized_gain_account_id as string | null,
    unrealizedLossAccountId: data.unrealized_loss_account_id as string | null,
    autoFetchRates: Boolean(data.auto_fetch_rates),
  }
}
