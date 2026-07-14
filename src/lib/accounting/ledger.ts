import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCompanyId } from '@/lib/tenant'
import type { CanonicalAccountType, LedgerEntryRecord, LedgerSourceType, NormalBalance } from './types'
import { signedBalance } from './normal-balance'

function mapLedgerRow(row: Record<string, unknown>): LedgerEntryRecord {
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    accountId: String(row.account_id),
    journalEntryId: (row.journal_entry_id as string | null) ?? null,
    journalLineId: (row.journal_line_id as string | null) ?? null,
    sourceType: String(row.source_type) as LedgerSourceType,
    sourceId: (row.source_id as string | null) ?? null,
    entryDate: new Date(String(row.entry_date)),
    description: (row.description as string | null) ?? null,
    debit: Number(row.debit ?? 0),
    credit: Number(row.credit ?? 0),
    currency: String(row.currency ?? 'SAR'),
    costCenterId: (row.cost_center_id as string | null) ?? null,
    postedAt: new Date(String(row.posted_at)),
    createdAt: new Date(String(row.created_at)),
  }
}

export interface LedgerQueryOptions {
  companyId?: string
  accountId?: string
  from?: Date
  to?: Date
  sourceType?: LedgerSourceType
  limit?: number
  offset?: number
}

export async function queryLedgerEntries(options: LedgerQueryOptions = {}): Promise<LedgerEntryRecord[]> {
  const companyId = options.companyId ?? await resolveCompanyId()
  const client = createAdminClient()

  let query = client
    .from('ledger_entries')
    .select('*')
    .eq('company_id', companyId)
    .order('entry_date', { ascending: true })
    .order('posting_sequence', { ascending: true })
    .order('posted_at', { ascending: true })

  if (options.accountId) query = query.eq('account_id', options.accountId)
  if (options.from) query = query.gte('entry_date', options.from.toISOString())
  if (options.to) query = query.lte('entry_date', options.to.toISOString())
  if (options.sourceType) query = query.eq('source_type', options.sourceType)
  if (options.limit) query = query.limit(options.limit)
  if (options.offset) query = query.range(options.offset, options.offset + (options.limit ?? 50) - 1)

  const { data, error } = await query
  if (error) throw error
  return (data ?? []).map(mapLedgerRow)
}

export interface AccountBalanceAgg {
  accountId: string
  accountNo: string
  accountName: string
  canonicalType: CanonicalAccountType
  normalBalance: NormalBalance
  totalDebit: number
  totalCredit: number
  balance: number
}

export async function aggregateLedgerBalances(options: {
  companyId?: string
  asOf?: Date
  from?: Date
  to?: Date
  canonicalTypes?: CanonicalAccountType[]
}): Promise<AccountBalanceAgg[]> {
  const companyId = options.companyId ?? await resolveCompanyId()
  const client = createAdminClient()

  let ledgerQuery = client
    .from('ledger_entries')
    .select('account_id, debit, credit')
    .eq('company_id', companyId)

  if (options.asOf) ledgerQuery = ledgerQuery.lte('entry_date', options.asOf.toISOString())
  if (options.from) ledgerQuery = ledgerQuery.gte('entry_date', options.from.toISOString())
  if (options.to) ledgerQuery = ledgerQuery.lte('entry_date', options.to.toISOString())

  const { data: ledgerRows, error: ledgerError } = await ledgerQuery
  if (ledgerError) throw ledgerError

  let accountsQuery = client
    .from('chart_of_accounts')
    .select('id, account_no, name, full_name, canonical_type, normal_balance, sub_type, is_active')
    .eq('company_id', companyId)
    .is('deleted_at', null)
    .neq('sub_type', 'Header')

  if (options.canonicalTypes?.length) {
    accountsQuery = accountsQuery.in('canonical_type', options.canonicalTypes)
  }

  const { data: accounts, error: accountsError } = await accountsQuery
  if (accountsError) throw accountsError

  const totals = new Map<string, { debit: number; credit: number }>()
  for (const row of ledgerRows ?? []) {
    const accountId = String(row.account_id)
    const bucket = totals.get(accountId) ?? { debit: 0, credit: 0 }
    bucket.debit += Number(row.debit ?? 0)
    bucket.credit += Number(row.credit ?? 0)
    totals.set(accountId, bucket)
  }

  return (accounts ?? []).map((acc) => {
    const agg = totals.get(String(acc.id)) ?? { debit: 0, credit: 0 }
    const canonicalType = String(acc.canonical_type ?? 'Asset') as CanonicalAccountType
    const normalBalance = String(acc.normal_balance ?? 'DEBIT') as NormalBalance
    return {
      accountId: String(acc.id),
      accountNo: String(acc.account_no),
      accountName: String(acc.full_name ?? acc.name),
      canonicalType,
      normalBalance,
      totalDebit: agg.debit,
      totalCredit: agg.credit,
      balance: signedBalance(agg.debit, agg.credit, normalBalance),
    }
  })
}

export async function getGeneralLedgerReport(options: {
  accountId?: string
  from: Date
  to: Date
  companyId?: string
  limit?: number
  offset?: number
}) {
  const companyId = options.companyId ?? await resolveCompanyId()
  const client = createAdminClient()

  let query = client
    .from('ledger_entries')
    .select(`
      *,
      account:chart_of_accounts!ledger_entries_account_id_fkey(account_no, name, account_type, canonical_type, normal_balance),
      cost_center:cost_centers(name)
    `, { count: 'exact' })
    .eq('company_id', companyId)
    .gte('entry_date', options.from.toISOString())
    .lte('entry_date', options.to.toISOString())
    .order('entry_date', { ascending: true })
    .order('posting_sequence', { ascending: true })

  if (options.accountId) query = query.eq('account_id', options.accountId)
  const pageSize = options.limit ?? 500
  const offset = options.offset ?? 0
  query = query.range(offset, offset + pageSize - 1)

  const { data, error, count } = await query
  if (error) throw error

  let runningBalance = 0
  const entries = (data ?? []).map((row) => {
    const debit = Number(row.debit ?? 0)
    const credit = Number(row.credit ?? 0)
    runningBalance += debit - credit
    const account = row.account as Record<string, unknown> | null
    const costCenter = row.cost_center as Record<string, unknown> | null
    return {
      date: row.entry_date,
      entryNo: row.journal_entry_id,
      description: row.description,
      debit,
      credit,
      balance: runningBalance,
      sourceType: row.source_type,
      sourceId: row.source_id,
      account: account
        ? {
            accountNo: account.account_no,
            name: account.name,
            accountType: account.canonical_type ?? account.account_type,
          }
        : null,
      costCenter: costCenter ? { name: costCenter.name } : null,
    }
  })

  const totalDebit = entries.reduce((s, e) => s + e.debit, 0)
  const totalCredit = entries.reduce((s, e) => s + e.credit, 0)

  return {
    period: { from: options.from.toISOString(), to: options.to.toISOString() },
    entries,
    totals: { debit: totalDebit, credit: totalCredit, balance: totalDebit - totalCredit },
    pagination: { total: count ?? entries.length, limit: pageSize, offset },
  }
}
