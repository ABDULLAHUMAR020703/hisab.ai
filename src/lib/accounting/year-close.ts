import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCompanyId } from '@/lib/tenant'
import { getNextSequence } from '@/lib/sequences'
import { postJournalEntry, findSystemAccount } from './posting-service'
import { validateFiscalPeriodOpen } from './validation'
import { logPostingAudit } from './posting-audit'
import { aggregateLedgerBalances } from './ledger'
import { closeFiscalPeriod } from './fiscal-periods'

export interface YearCloseResult {
  fiscalYear: number
  netIncome: number
  closingJournalId: string
  openingJournalId: string
  nextPeriodId: string
  postingSequence: number
}

export async function closeFiscalYear(options: {
  periodId: string
  userId: string
  companyId?: string
  reason?: string
  ipAddress?: string | null
}): Promise<YearCloseResult> {
  const companyId = options.companyId ?? await resolveCompanyId()
  const client = createAdminClient()

  const { data: period, error: periodError } = await client
    .from('fiscal_periods')
    .select('*')
    .eq('id', options.periodId)
    .eq('company_id', companyId)
    .single()

  if (periodError || !period) throw new Error('Fiscal period not found')
  if (period.status === 'CLOSED') throw new Error('Fiscal period is already closed')

  const periodEnd = new Date(String(period.period_end))
  const periodStart = new Date(String(period.period_start))
  const fiscalYear = periodStart.getFullYear()

  const { data: existingClose } = await client
    .from('fiscal_year_closings')
    .select('id')
    .eq('company_id', companyId)
    .eq('fiscal_year', fiscalYear)
    .maybeSingle()

  if (existingClose) throw new Error(`Fiscal year ${fiscalYear} is already closed`)

  await validateFiscalPeriodOpen(companyId, periodEnd)

  const balances = await aggregateLedgerBalances({
    companyId,
    from: periodStart,
    to: periodEnd,
    canonicalTypes: ['Income', 'Expense', 'CostOfGoodsSold'],
  })

  let totalIncome = 0
  let totalExpense = 0
  for (const b of balances) {
    if (b.canonicalType === 'Income') totalIncome += b.balance
    else totalExpense += b.balance
  }
  const netIncome = totalIncome - totalExpense

  const retainedEarningsId = await findSystemAccount(companyId, {
    nameContains: 'Retained Earnings',
    canonicalType: 'Equity',
  })
  if (!retainedEarningsId) throw new Error('Retained Earnings account not found')

  const closingLines: Array<{ accountId: string; debit: number; credit: number; description: string }> = []

  for (const b of balances) {
    if (Math.abs(b.balance) < 0.0001) continue
    if (b.canonicalType === 'Income') {
      closingLines.push({
        accountId: b.accountId,
        debit: b.balance,
        credit: 0,
        description: `Close ${b.accountName} to retained earnings`,
      })
    } else if (b.canonicalType === 'Expense' || b.canonicalType === 'CostOfGoodsSold') {
      closingLines.push({
        accountId: b.accountId,
        debit: 0,
        credit: b.balance,
        description: `Close ${b.accountName} to retained earnings`,
      })
    }
  }

  if (Math.abs(netIncome) > 0.0001) {
    if (netIncome > 0) {
      closingLines.push({
        accountId: retainedEarningsId,
        debit: 0,
        credit: netIncome,
        description: 'Net income to retained earnings',
      })
    } else {
      closingLines.push({
        accountId: retainedEarningsId,
        debit: Math.abs(netIncome),
        credit: 0,
        description: 'Net loss to retained earnings',
      })
    }
  }

  const closingEntryNo = await getNextSequence('JOURNAL', 'JV-')
  const { data: closingEntry, error: closingError } = await client
    .from('journal_entries')
    .insert({
      company_id: companyId,
      entry_no: closingEntryNo,
      date: periodEnd.toISOString(),
      description: `Year-end closing ${fiscalYear}`,
      status: 'DRAFT',
      total_debit: closingLines.reduce((s, l) => s + l.debit, 0),
      total_credit: closingLines.reduce((s, l) => s + l.credit, 0),
      created_by_id: options.userId,
      entry_type: 'CLOSING',
      post_reason: options.reason ?? 'Fiscal year close',
      currency: 'SAR',
    })
    .select('id')
    .single()

  if (closingError) throw closingError
  const closingJournalId = String(closingEntry.id)

  if (closingLines.length > 0) {
    await client.from('journal_lines').insert(
      closingLines.map((l) => ({
        company_id: companyId,
        journal_id: closingJournalId,
        account_id: l.accountId,
        description: l.description,
        debit: l.debit,
        credit: l.credit,
      })),
    )
    await postJournalEntry(closingJournalId, { companyId, userId: options.userId, reason: options.reason, ipAddress: options.ipAddress })
  }

  const assetBalances = await aggregateLedgerBalances({
    companyId,
    asOf: periodEnd,
    canonicalTypes: ['Asset', 'Liability', 'Equity'],
  })

  const nextYear = fiscalYear + 1
  const nextStart = new Date(nextYear, 0, 1)
  const nextEnd = new Date(nextYear, 11, 31, 23, 59, 59)

  const { data: nextPeriod, error: nextPeriodError } = await client
    .from('fiscal_periods')
    .insert({
      company_id: companyId,
      name: `${nextYear} Fiscal Year`,
      period_start: nextStart.toISOString(),
      period_end: nextEnd.toISOString(),
      status: 'OPEN',
    })
    .select('id')
    .single()

  if (nextPeriodError) throw nextPeriodError

  const openingLines = assetBalances
    .filter((b) => Math.abs(b.balance) > 0.0001)
    .map((b) => {
      const amount = Math.abs(b.balance)
      if (b.normalBalance === 'DEBIT') {
        return {
          accountId: b.accountId,
          debit: amount,
          credit: 0,
          description: `Opening balance ${nextYear}`,
        }
      }
      return {
        accountId: b.accountId,
        debit: 0,
        credit: amount,
        description: `Opening balance ${nextYear}`,
      }
    })

  const openingEntryNo = await getNextSequence('JOURNAL', 'JV-')
  const totalDebit = openingLines.reduce((s, l) => s + l.debit, 0)
  const totalCredit = openingLines.reduce((s, l) => s + l.credit, 0)

  const { data: openingEntry, error: openingError } = await client
    .from('journal_entries')
    .insert({
      company_id: companyId,
      entry_no: openingEntryNo,
      date: nextStart.toISOString(),
      description: `Opening balances ${nextYear}`,
      status: 'DRAFT',
      total_debit: totalDebit,
      total_credit: totalCredit,
      created_by_id: options.userId,
      entry_type: 'OPENING',
      post_reason: 'Auto-generated opening balances',
      currency: 'SAR',
    })
    .select('id')
    .single()

  if (openingError) throw openingError
  const openingJournalId = String(openingEntry.id)

  if (openingLines.length > 0) {
    await client.from('journal_lines').insert(
      openingLines.map((l) => ({
        company_id: companyId,
        journal_id: openingJournalId,
        account_id: l.accountId,
        description: l.description,
        debit: l.debit,
        credit: l.credit,
      })),
    )
    await postJournalEntry(openingJournalId, { companyId, userId: options.userId, reason: 'Opening balances', ipAddress: options.ipAddress })
  }

  await closeFiscalPeriod(options.periodId, options.userId, companyId)

  const { data: closingPosted } = await client
    .from('journal_entries')
    .select('posting_sequence')
    .eq('id', closingJournalId)
    .maybeSingle()

  await client.from('fiscal_year_closings').insert({
    company_id: companyId,
    fiscal_year: fiscalYear,
    period_id: options.periodId,
    net_income: netIncome,
    closing_journal_id: closingJournalId,
    opening_journal_id: openingJournalId,
    closed_by_id: options.userId,
  })

  await logPostingAudit({
    action: 'FISCAL_YEAR_CLOSED',
    entityType: 'fiscal_period',
    entityId: options.periodId,
    userId: options.userId,
    companyId,
    reason: options.reason ?? 'Fiscal year close',
    ipAddress: options.ipAddress,
    beforeState: { fiscalYear, status: 'OPEN', netIncome },
    afterState: {
      closingJournalId,
      openingJournalId,
      nextPeriodId: String(nextPeriod.id),
      postingSequence: closingPosted?.posting_sequence,
    },
  })

  return {
    fiscalYear,
    netIncome,
    closingJournalId,
    openingJournalId,
    nextPeriodId: String(nextPeriod.id),
    postingSequence: Number(closingPosted?.posting_sequence ?? 0),
  }
}
