import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCompanyId } from '@/lib/tenant'
import { findSystemAccount, postSourceDocumentToLedger } from '@/lib/accounting/posting-service'
import { getCurrencyRoles, getCurrencySettings } from './fx-accounts'
import { getExchangeRateAtDate, lookupExchangeRate } from './exchange-rates'
import { computeUnrealizedAdjustment } from './fx-conversion'

export interface RevaluationPreviewLine {
  accountId: string
  accountNo: string
  accountName: string
  currency: string
  transactionBalance: number
  priorRate: number
  newRate: number
  priorBaseBalance: number
  newBaseBalance: number
  adjustmentAmount: number
}

export interface RevaluationPreview {
  revaluationDate: string
  baseCurrency: string
  reportingCurrency: string
  lines: RevaluationPreviewLine[]
  totalGain: number
  totalLoss: number
  netAdjustment: number
}

export async function previewCurrencyRevaluation(
  revaluationDate: Date,
  companyId?: string,
): Promise<RevaluationPreview> {
  const cid = companyId ?? await resolveCompanyId()
  const client = createAdminClient()
  const roles = await getCurrencyRoles(cid)

  const { data: accounts, error } = await client
    .from('chart_of_accounts')
    .select('id, account_no, name, balance, canonical_type')
    .eq('company_id', cid)
    .in('canonical_type', ['Asset', 'Liability'])
    .eq('is_active', true)
    .is('deleted_at', null)

  if (error) throw error

  const lines: RevaluationPreviewLine[] = []
  let totalGain = 0
  let totalLoss = 0

  for (const account of accounts ?? []) {
    const { data: ledgerRows } = await client
      .from('ledger_entries')
      .select('currency, debit, credit, exchange_rate')
      .eq('company_id', cid)
      .eq('account_id', account.id)
      .lte('entry_date', revaluationDate.toISOString())

    const currencyTotals = new Map<string, { balance: number; lastRate: number }>()
    for (const row of ledgerRows ?? []) {
      const currency = String(row.currency ?? roles.baseCurrency)
      if (currency === roles.baseCurrency) continue
      const net = Number(row.debit ?? 0) - Number(row.credit ?? 0)
      const existing = currencyTotals.get(currency) ?? { balance: 0, lastRate: Number(row.exchange_rate ?? 1) }
      existing.balance += net
      if (row.exchange_rate) existing.lastRate = Number(row.exchange_rate)
      currencyTotals.set(currency, existing)
    }

    for (const [currency, totals] of currencyTotals) {
      if (Math.abs(totals.balance) < 0.0001) continue

      const { rate: newRate } = await lookupExchangeRate({
        fromCurrency: currency,
        toCurrency: roles.baseCurrency,
        asOf: revaluationDate,
        companyId: cid,
      })

      const priorRate = totals.lastRate || await getExchangeRateAtDate(currency, roles.baseCurrency, revaluationDate, cid)
      const adjustment = computeUnrealizedAdjustment({
        transactionBalance: totals.balance,
        priorRate,
        newRate,
      })

      if (Math.abs(adjustment) < 0.01) continue

      const priorBase = totals.balance * priorRate
      const newBase = totals.balance * newRate

      lines.push({
        accountId: String(account.id),
        accountNo: String(account.account_no),
        accountName: String(account.name),
        currency,
        transactionBalance: totals.balance,
        priorRate,
        newRate,
        priorBaseBalance: priorBase,
        newBaseBalance: newBase,
        adjustmentAmount: adjustment,
      })

      if (adjustment > 0) totalGain += adjustment
      else totalLoss += Math.abs(adjustment)
    }
  }

  return {
    revaluationDate: revaluationDate.toISOString(),
    baseCurrency: roles.baseCurrency,
    reportingCurrency: roles.reportingCurrency,
    lines,
    totalGain: Math.round(totalGain * 10000) / 10000,
    totalLoss: Math.round(totalLoss * 10000) / 10000,
    netAdjustment: Math.round((totalGain - totalLoss) * 10000) / 10000,
  }
}

export async function runCurrencyRevaluation(input: {
  revaluationDate: Date
  companyId?: string
  userId?: string | null
  notes?: string | null
}): Promise<{ revaluationId: string; journalPosted: boolean }> {
  const cid = input.companyId ?? await resolveCompanyId()
  const client = createAdminClient()
  const preview = await previewCurrencyRevaluation(input.revaluationDate, cid)
  const settings = await getCurrencySettings(cid)

  if (preview.lines.length === 0) {
    throw new Error('No foreign currency balances require revaluation')
  }

  const unrealizedGain = settings?.unrealizedGainAccountId
    ?? await findSystemAccount(cid, { nameContains: 'Unrealized FX Gain' })
  const unrealizedLoss = settings?.unrealizedLossAccountId
    ?? await findSystemAccount(cid, { nameContains: 'Unrealized FX Loss' })

  const { data: revaluation, error: revError } = await client
    .from('fx_revaluations')
    .insert({
      company_id: cid,
      revaluation_date: input.revaluationDate.toISOString(),
      status: 'DRAFT',
      base_currency: preview.baseCurrency,
      reporting_currency: preview.reportingCurrency,
      total_unrealized_gain: preview.totalGain,
      total_unrealized_loss: preview.totalLoss,
      created_by_id: input.userId ?? null,
      notes: input.notes ?? null,
    })
    .select('id')
    .single()

  if (revError) throw revError

  const revaluationId = String(revaluation.id)
  const lineRows = preview.lines.map((line) => ({
    revaluation_id: revaluationId,
    company_id: cid,
    account_id: line.accountId,
    currency: line.currency,
    balance_transaction: line.transactionBalance,
    prior_rate: line.priorRate,
    new_rate: line.newRate,
    prior_base_balance: line.priorBaseBalance,
    new_base_balance: line.newBaseBalance,
    adjustment_amount: line.adjustmentAmount,
  }))

  const { error: linesError } = await client.from('fx_revaluation_lines').insert(lineRows)
  if (linesError) throw linesError

  const postingLines: Array<{ accountId: string; debit?: number; credit?: number; description?: string }> = []

  for (const line of preview.lines) {
    if (line.adjustmentAmount > 0) {
      postingLines.push({
        accountId: line.accountId,
        debit: line.adjustmentAmount,
        description: `Unrealized FX revaluation ${line.currency}`,
      })
      if (unrealizedGain) {
        postingLines.push({
          accountId: unrealizedGain,
          credit: line.adjustmentAmount,
          description: `Unrealized FX gain ${line.currency}`,
        })
      }
    } else {
      const loss = Math.abs(line.adjustmentAmount)
      postingLines.push({
        accountId: line.accountId,
        credit: loss,
        description: `Unrealized FX revaluation ${line.currency}`,
      })
      if (unrealizedLoss) {
        postingLines.push({
          accountId: unrealizedLoss,
          debit: loss,
          description: `Unrealized FX loss ${line.currency}`,
        })
      }
    }
  }

  if (postingLines.length >= 2) {
    await postSourceDocumentToLedger({
      companyId: cid,
      sourceType: 'FX_REVALUATION',
      sourceId: revaluationId,
      entryDate: input.revaluationDate,
      description: `Currency revaluation ${input.revaluationDate.toISOString().substring(0, 10)}`,
      currency: preview.baseCurrency,
      lines: postingLines,
      userId: input.userId,
      reason: input.notes ?? 'Currency revaluation',
    })
  }

  await client
    .from('fx_revaluations')
    .update({ status: 'POSTED' })
    .eq('id', revaluationId)

  return { revaluationId, journalPosted: postingLines.length >= 2 }
}
