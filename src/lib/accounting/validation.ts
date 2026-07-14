import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCompanyId } from '@/lib/tenant'
import { getCompanyPrimaryCurrency } from '@/lib/currency/company'
import { getExchangeRate } from '@/lib/currency/exchange-rates'
import {
  type JournalLineInput,
  PostingValidationError,
  validateBalanced,
} from './validation-rules'

export type { JournalLineInput }
export { PostingValidationError, validateBalanced }

export interface PostingValidationContext {
  companyId: string
  entryDate: Date
  lines: JournalLineInput[]
  currency?: string
  branchId?: string | null
}

export async function validateAccountsActive(
  companyId: string,
  lines: JournalLineInput[],
): Promise<void> {
  const client = createAdminClient()
  const accountIds = [...new Set(lines.map((l) => l.accountId))]

  const { data, error } = await client
    .from('chart_of_accounts')
    .select('id, account_no, is_active, company_id')
    .in('id', accountIds)
    .eq('company_id', companyId)
    .is('deleted_at', null)

  if (error) throw error

  if ((data?.length ?? 0) !== accountIds.length) {
    throw new PostingValidationError('One or more accounts not found or belong to another company', 'ACCOUNT_NOT_FOUND')
  }

  for (const acc of data ?? []) {
    if (!acc.is_active) {
      throw new PostingValidationError(`Account ${acc.account_no} is inactive`, 'ACCOUNT_INACTIVE')
    }
  }
}

export async function validateFiscalPeriodOpen(companyId: string, date: Date): Promise<void> {
  const client = createAdminClient()
  const { data, error } = await client
    .from('fiscal_periods')
    .select('status')
    .eq('company_id', companyId)
    .lte('period_start', date.toISOString())
    .gte('period_end', date.toISOString())
    .eq('status', 'CLOSED')
    .limit(1)

  if (error) throw error
  if ((data?.length ?? 0) > 0) {
    throw new PostingValidationError('Fiscal period is closed', 'PERIOD_CLOSED')
  }
}

export async function validateCurrency(
  companyId: string,
  currency?: string,
): Promise<string> {
  const primary = await getCompanyPrimaryCurrency()
  const code = (currency ?? primary).trim().toUpperCase()

  const client = createAdminClient()
  const { data, error } = await client
    .from('company_currencies')
    .select('code')
    .eq('company_id', companyId)
    .eq('code', code)
    .eq('is_active', true)
    .maybeSingle()

  if (error) throw error
  if (!data && code !== primary) {
    throw new PostingValidationError(`Currency ${code} is not configured for this company`, 'CURRENCY_INVALID')
  }
  return code
}

export async function validateExchangeRate(
  companyId: string,
  fromCurrency: string,
  toCurrency: string,
): Promise<void> {
  if (fromCurrency === toCurrency) return
  const rate = await getExchangeRate(fromCurrency, toCurrency, companyId)
  if (!rate || rate <= 0) {
    throw new PostingValidationError(
      `No exchange rate from ${fromCurrency} to ${toCurrency}`,
      'EXCHANGE_RATE_MISSING',
    )
  }
}

export async function validateCostCenter(
  companyId: string,
  costCenterId: string | null | undefined,
): Promise<void> {
  if (!costCenterId) return
  const client = createAdminClient()
  const { data, error } = await client
    .from('cost_centers')
    .select('id')
    .eq('id', costCenterId)
    .eq('company_id', companyId)
    .eq('is_active', true)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) throw error
  if (!data) {
    throw new PostingValidationError('Invalid or inactive cost center / project', 'COST_CENTER_INVALID')
  }
}

export async function validateDepartment(
  companyId: string,
  departmentId: string | null | undefined,
): Promise<void> {
  if (!departmentId) return
  const client = createAdminClient()
  const { data, error } = await client
    .from('departments')
    .select('id')
    .eq('id', departmentId)
    .eq('company_id', companyId)
    .eq('is_active', true)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) throw error
  if (!data) {
    throw new PostingValidationError('Invalid or inactive department', 'DEPARTMENT_INVALID')
  }
}

export async function validateTaxRate(
  companyId: string,
  taxRateId: string | null | undefined,
): Promise<void> {
  if (!taxRateId) return
  const client = createAdminClient()
  const { data, error } = await client
    .from('tax_rates')
    .select('id')
    .eq('id', taxRateId)
    .eq('company_id', companyId)
    .eq('is_active', true)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) throw error
  if (!data) {
    throw new PostingValidationError('Invalid or inactive tax rate', 'TAX_RATE_INVALID')
  }
}

export async function validateNoDuplicatePosting(
  companyId: string,
  journalId: string,
): Promise<void> {
  const client = createAdminClient()
  const { data, error } = await client
    .from('ledger_entries')
    .select('id')
    .eq('company_id', companyId)
    .eq('journal_entry_id', journalId)
    .limit(1)

  if (error) throw error
  if ((data?.length ?? 0) > 0) {
    throw new PostingValidationError('Duplicate posting prevented', 'DUPLICATE_POSTING')
  }
}

export async function validateAccountDeletable(accountId: string, companyId?: string): Promise<void> {
  const cid = companyId ?? await resolveCompanyId()
  const client = createAdminClient()
  const { data, error } = await client
    .from('ledger_entries')
    .select('id')
    .eq('company_id', cid)
    .eq('account_id', accountId)
    .limit(1)

  if (error) throw error
  if ((data?.length ?? 0) > 0) {
    throw new PostingValidationError(
      'Cannot delete account with posted ledger transactions',
      'ACCOUNT_HAS_TRANSACTIONS',
    )
  }
}

export async function validatePostingContext(ctx: PostingValidationContext): Promise<string> {
  validateBalanced(ctx.lines)
  await validateFiscalPeriodOpen(ctx.companyId, ctx.entryDate)
  await validateAccountsActive(ctx.companyId, ctx.lines)

  const currency = await validateCurrency(ctx.companyId, ctx.currency)
  const primary = await getCompanyPrimaryCurrency()
  if (currency !== primary) {
    await validateExchangeRate(ctx.companyId, currency, primary)
  }

  for (const line of ctx.lines) {
    await validateCostCenter(ctx.companyId, line.costCenterId)
  }

  return currency
}
