import type { CanonicalAccountType, NormalBalance } from './types'
import { inferNormalBalance } from './normal-balance'

const TYPE_MAP: Record<string, CanonicalAccountType> = {
  Asset: 'Asset',
  Bank: 'Asset',
  'Accounts Receivable': 'Asset',
  'Other Current Asset': 'Asset',
  'Fixed Asset': 'Asset',
  'Other Asset': 'Asset',
  'Cash and Cash Equivalents': 'Asset',
  Liability: 'Liability',
  'Accounts Payable': 'Liability',
  'Credit Card': 'Liability',
  'Other Current Liability': 'Liability',
  'Long Term Liability': 'Liability',
  Equity: 'Equity',
  Income: 'Income',
  'Other Income': 'Income',
  Expense: 'Expense',
  Expenses: 'Expense',
  'Other Expense': 'Expense',
  CostOfGoodsSold: 'CostOfGoodsSold',
  'Cost of Goods Sold': 'CostOfGoodsSold',
}

export function toCanonicalAccountType(accountType: string): CanonicalAccountType {
  return TYPE_MAP[accountType] ?? 'Asset'
}

export function resolveAccountClassification(accountType: string): {
  canonicalType: CanonicalAccountType
  normalBalance: NormalBalance
} {
  const canonicalType = toCanonicalAccountType(accountType)
  return {
    canonicalType,
    normalBalance: inferNormalBalance(canonicalType),
  }
}
