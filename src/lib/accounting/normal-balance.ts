import type { CanonicalAccountType, NormalBalance } from './types'

const DEBIT_NORMAL: CanonicalAccountType[] = ['Asset', 'Expense', 'CostOfGoodsSold']
const CREDIT_NORMAL: CanonicalAccountType[] = ['Liability', 'Equity', 'Income']

export function inferNormalBalance(canonicalType: CanonicalAccountType): NormalBalance {
  if (DEBIT_NORMAL.includes(canonicalType)) return 'DEBIT'
  return 'CREDIT'
}

export function signedBalance(
  debit: number,
  credit: number,
  normalBalance: NormalBalance,
): number {
  const net = debit - credit
  return normalBalance === 'DEBIT' ? net : -net
}

export function isDebitNormal(canonicalType: CanonicalAccountType): boolean {
  return DEBIT_NORMAL.includes(canonicalType)
}
