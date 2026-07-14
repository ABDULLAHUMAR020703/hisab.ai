import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCompanyId } from '@/lib/tenant'
import { getNextSequence } from '@/lib/sequences'

const SERIES_TO_LEGACY: Record<string, [string, string]> = {
  INVOICE: ['INVOICE', 'INV-'],
  BILL: ['BILL', 'BILL-'],
  JOURNAL: ['JOURNAL', 'JV-'],
  PAYMENT: ['PAYMENT', 'PAY-'],
  EXPENSE: ['EXPENSE', 'EXP-'],
  PAYROLL: ['PAYROLL', 'PRL-'],
  PURCHASE_ORDER: ['PURCHASE_ORDER', 'PO-'],
  SALES_ORDER: ['SALES_ORDER', 'SO-'],
  ESTIMATE: ['ESTIMATE', 'EST-'],
  VENDOR_CREDIT: ['VENDOR_CREDIT', 'VC-'],
  FIXED_ASSET: ['FIXED_ASSET', 'FA-'],
  INVENTORY: ['ITEM', 'ITM-'],
}

export async function getNextNumber(seriesKey: string, options?: {
  companyId?: string
  branchCode?: string | null
  fiscalYear?: number
}) {
  const companyId = options?.companyId ?? await resolveCompanyId()
  const client = createAdminClient()

  let query = client
    .from('numbering_series')
    .select('*')
    .eq('company_id', companyId)
    .eq('series_key', seriesKey)
    .eq('is_active', true)

  if (options?.branchCode) {
    query = query.eq('branch_code', options.branchCode)
  } else {
    query = query.is('branch_code', null)
  }

  const { data: series } = await query.maybeSingle()

  if (!series) {
    const legacy = SERIES_TO_LEGACY[seriesKey]
    if (legacy) return getNextSequence(legacy[0], legacy[1])
    return getNextSequence(seriesKey, `${seriesKey.substring(0, 3)}-`)
  }

  const nextNum = Number(series.next_number)
  const fiscalYear = options?.fiscalYear ?? new Date().getFullYear()
  const yearPart = series.include_fiscal_year ? String(fiscalYear) : ''
  const padded = String(nextNum).padStart(Number(series.padding), '0')
  const number = `${series.prefix}${yearPart}${padded}${series.suffix}`

  await client
    .from('numbering_series')
    .update({ next_number: nextNum + 1 })
    .eq('id', series.id)

  return number
}

export async function upsertNumberingSeries(input: {
  seriesKey: string
  prefix?: string
  suffix?: string
  padding?: number
  includeFiscalYear?: boolean
  branchCode?: string | null
  companyId?: string
}) {
  const companyId = input.companyId ?? await resolveCompanyId()
  const client = createAdminClient()

  const { data, error } = await client
    .from('numbering_series')
    .upsert({
      company_id: companyId,
      series_key: input.seriesKey,
      prefix: input.prefix ?? '',
      suffix: input.suffix ?? '',
      padding: input.padding ?? 5,
      include_fiscal_year: input.includeFiscalYear ?? false,
      branch_code: input.branchCode ?? null,
      is_active: true,
    }, { onConflict: 'company_id,series_key,branch_code' })
    .select('*')
    .single()

  if (error) throw error
  return data
}
