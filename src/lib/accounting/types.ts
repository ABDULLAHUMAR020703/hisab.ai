export type CanonicalAccountType =
  | 'Asset'
  | 'Liability'
  | 'Equity'
  | 'Income'
  | 'Expense'
  | 'CostOfGoodsSold'

export type NormalBalance = 'DEBIT' | 'CREDIT'

export type JournalEntryType =
  | 'STANDARD'
  | 'REVERSING'
  | 'ADJUSTING'
  | 'CLOSING'
  | 'OPENING'

export type LedgerSourceType =
  | 'JOURNAL'
  | 'INVOICE'
  | 'BILL'
  | 'EXPENSE'
  | 'PAYMENT'
  | 'PAYROLL'
  | 'OPENING_BALANCE'
  | 'ADJUSTMENT'
  | 'REVERSAL'
  | 'YEAR_CLOSE'
  | 'FX_REVALUATION'
  | 'REALIZED_FX'
  | 'UNREALIZED_FX'
  | 'INVENTORY'

export interface LedgerEntryRecord {
  id: string
  companyId: string
  accountId: string
  journalEntryId: string | null
  journalLineId: string | null
  sourceType: LedgerSourceType
  sourceId: string | null
  entryDate: Date
  description: string | null
  debit: number
  credit: number
  currency: string
  costCenterId: string | null
  postedAt: Date
  createdAt: Date
}

export interface TrialBalanceRow {
  accountId: string
  accountNo: string
  accountName: string
  canonicalType: CanonicalAccountType
  normalBalance: NormalBalance
  debit: number
  credit: number
  balance: number
}

export interface FiscalPeriodRecord {
  id: string
  companyId: string
  name: string
  periodStart: Date
  periodEnd: Date
  status: 'OPEN' | 'CLOSED'
  closedAt: Date | null
  closedById: string | null
}
