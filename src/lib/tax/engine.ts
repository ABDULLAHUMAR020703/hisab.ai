import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCompanyId } from '@/lib/tenant'
import {
  computeLegacyLineTax,
  computeLineTaxFromRates,
  roundMoney,
  sumDocumentTaxes,
  type LineTaxResult,
  type TaxCompoundMethod,
  type TaxRateDefinition,
} from './calculator'

export interface DocumentLineTaxInput {
  description: string
  quantity: number
  unitPrice: number
  taxRate?: number
  taxRateId?: string | null
  taxGroupId?: string | null
  accountId?: string | null
  costCenterId?: string | null
  inventoryItemId?: string | null
}

export interface DocumentTaxContext {
  companyId?: string
  customerId?: string | null
  vendorId?: string | null
  regionCode?: string | null
  documentType?: 'INVOICE' | 'BILL' | 'EXPENSE'
  entryDate?: Date
}

export class TaxValidationError extends Error {
  constructor(message: string, public code: string) {
    super(message)
    this.name = 'TaxValidationError'
  }
}

async function loadTaxRate(id: string, companyId: string): Promise<TaxRateDefinition | null> {
  const client = createAdminClient()
  const { data, error } = await client
    .from('tax_rates')
    .select('id, name, rate, type, tax_mode, is_reverse_charge, is_withholding')
    .eq('id', id)
    .eq('company_id', companyId)
    .eq('is_active', true)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) throw error
  if (!data) return null
  return {
    id: String(data.id),
    name: String(data.name),
    rate: Number(data.rate),
    type: String(data.type ?? 'VAT'),
    taxMode: (data.tax_mode as 'EXCLUSIVE' | 'INCLUSIVE') ?? 'EXCLUSIVE',
    isReverseCharge: Boolean(data.is_reverse_charge),
    isWithholding: Boolean(data.is_withholding),
  }
}

async function loadTaxGroupRates(groupId: string, companyId: string): Promise<{
  rates: TaxRateDefinition[]
  compoundMethod: TaxCompoundMethod
}> {
  const client = createAdminClient()
  const { data: group, error: groupError } = await client
    .from('tax_groups')
    .select('compound_method')
    .eq('id', groupId)
    .eq('company_id', companyId)
    .is('deleted_at', null)
    .maybeSingle()

  if (groupError) throw groupError
  if (!group) return { rates: [], compoundMethod: 'ADDITIVE' }

  const { data: links, error } = await client
    .from('tax_group_rates')
    .select('sequence, tax_rate_id')
    .eq('tax_group_id', groupId)
    .eq('company_id', companyId)
    .order('sequence', { ascending: true })

  if (error) throw error

  const rates: TaxRateDefinition[] = []
  for (const link of links ?? []) {
    const rate = await loadTaxRate(String(link.tax_rate_id), companyId)
    if (rate) rates.push(rate)
  }

  return {
    rates,
    compoundMethod: (group.compound_method as TaxCompoundMethod) ?? 'ADDITIVE',
  }
}

async function isLineExempt(
  companyId: string,
  ctx: DocumentTaxContext,
): Promise<boolean> {
  if (!ctx.customerId && !ctx.vendorId && !ctx.regionCode) return false

  const client = createAdminClient()
  let query = client
    .from('tax_exemptions')
    .select('id')
    .eq('company_id', companyId)
    .eq('is_active', true)
    .is('deleted_at', null)
    .limit(1)

  if (ctx.customerId) query = query.eq('customer_id', ctx.customerId)
  else if (ctx.vendorId) query = query.eq('vendor_id', ctx.vendorId)
  else if (ctx.regionCode) query = query.eq('region_code', ctx.regionCode)

  const { data, error } = await query
  if (error) throw error
  return (data?.length ?? 0) > 0
}

export async function resolveRegionalDefaultTaxRate(
  companyId: string,
  regionCode: string,
  documentType: string,
): Promise<TaxRateDefinition | null> {
  const client = createAdminClient()
  const { data, error } = await client
    .from('regional_tax_rules')
    .select('default_tax_rate_id, reverse_charge_default')
    .eq('company_id', companyId)
    .eq('region_code', regionCode)
    .eq('document_type', documentType)
    .eq('is_active', true)
    .maybeSingle()

  if (error) throw error
  if (!data?.default_tax_rate_id) return null

  const rate = await loadTaxRate(String(data.default_tax_rate_id), companyId)
  if (rate && data.reverse_charge_default) {
    rate.isReverseCharge = true
  }
  return rate
}

export async function computeDocumentLineTaxes(
  lines: DocumentLineTaxInput[],
  ctx: DocumentTaxContext = {},
): Promise<{
  processedLines: Array<DocumentLineTaxInput & {
    amount: number
    taxRate: number
    taxAmount: number
    taxRateId: string | null
    lineTax: LineTaxResult
  }>
  subtotal: number
  taxAmount: number
  total: number
  withholdingAmount: number
  reverseChargeAmount: number
}> {
  const companyId = ctx.companyId ?? await resolveCompanyId()
  const lineResults: LineTaxResult[] = []
  const processedLines: Array<DocumentLineTaxInput & {
    amount: number
    taxRate: number
    taxAmount: number
    taxRateId: string | null
    lineTax: LineTaxResult
  }> = []

  for (const line of lines) {
    let rates: TaxRateDefinition[] = []
    let compoundMethod: TaxCompoundMethod = 'ADDITIVE'

    if (line.taxGroupId) {
      const group = await loadTaxGroupRates(line.taxGroupId, companyId)
      rates = group.rates
      compoundMethod = group.compoundMethod
    } else if (line.taxRateId) {
      const rate = await loadTaxRate(line.taxRateId, companyId)
      if (!rate) {
        throw new TaxValidationError(`Tax rate not found: ${line.taxRateId}`, 'TAX_RATE_INVALID')
      }
      rates = [rate]
    } else if (line.taxRate !== undefined) {
      rates = [{
        name: 'VAT',
        rate: Number(line.taxRate),
        type: 'VAT',
        taxMode: 'EXCLUSIVE',
      }]
    } else if (ctx.regionCode && ctx.documentType) {
      const regional = await resolveRegionalDefaultTaxRate(companyId, ctx.regionCode, ctx.documentType)
      if (regional) rates = [regional]
      else rates = [{ name: 'VAT', rate: 15, type: 'VAT', taxMode: 'EXCLUSIVE' }]
    } else {
      const legacy = computeLegacyLineTax(line.quantity, line.unitPrice, Number(line.taxRate ?? 15))
      lineResults.push(legacy)
      processedLines.push({
        ...line,
        amount: legacy.netAmount,
        taxRate: legacy.effectiveTaxRate,
        taxAmount: legacy.taxAmount,
        taxRateId: line.taxRateId ?? null,
        lineTax: legacy,
      })
      continue
    }

    const exempt = await isLineExempt(companyId, ctx)
    const lineTax = computeLineTaxFromRates(line.quantity, line.unitPrice, rates, {
      compoundMethod,
      isExempt: exempt,
    })
    lineResults.push(lineTax)

    processedLines.push({
      ...line,
      amount: lineTax.netAmount,
      taxRate: lineTax.effectiveTaxRate,
      taxAmount: lineTax.taxAmount,
      taxRateId: line.taxRateId ?? rates[0]?.id ?? null,
      lineTax,
    })
  }

  const totals = sumDocumentTaxes(lineResults)
  return { processedLines, ...totals }
}

export function validateTaxTotals(subtotal: number, taxAmount: number, total: number): void {
  const expected = roundMoney(subtotal + taxAmount)
  if (Math.abs(expected - roundMoney(total)) > 0.02) {
    throw new TaxValidationError('Tax totals do not balance', 'TAX_TOTAL_MISMATCH')
  }
}
