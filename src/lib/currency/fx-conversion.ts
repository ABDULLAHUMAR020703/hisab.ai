export interface FxAmounts {
  transactionCurrency: string
  transactionDebit: number
  transactionCredit: number
  baseCurrency: string
  baseDebit: number
  baseCredit: number
  reportingCurrency: string
  reportingDebit: number
  reportingCredit: number
  exchangeRate: number
  reportingExchangeRate: number
}

export function roundFx(value: number, decimals = 4): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

export function convertAmountAtRate(amount: number, rate: number): number {
  return roundFx(amount * rate)
}

export function buildFxAmounts(input: {
  debit?: number
  credit?: number
  transactionCurrency: string
  baseCurrency: string
  reportingCurrency: string
  exchangeRate: number
  reportingExchangeRate?: number
}): FxAmounts {
  const transactionDebit = input.debit ?? 0
  const transactionCredit = input.credit ?? 0
  const rate = input.exchangeRate || 1
  const reportingRate = input.reportingExchangeRate ?? rate

  return {
    transactionCurrency: input.transactionCurrency,
    transactionDebit,
    transactionCredit,
    baseCurrency: input.baseCurrency,
    baseDebit: convertAmountAtRate(transactionDebit, rate),
    baseCredit: convertAmountAtRate(transactionCredit, rate),
    reportingCurrency: input.reportingCurrency,
    reportingDebit: convertAmountAtRate(transactionDebit, reportingRate),
    reportingCredit: convertAmountAtRate(transactionCredit, reportingRate),
    exchangeRate: rate,
    reportingExchangeRate: reportingRate,
  }
}

export function computeRealizedFxDifference(input: {
  transactionAmount: number
  originalRate: number
  settlementRate: number
}): number {
  const originalBase = convertAmountAtRate(input.transactionAmount, input.originalRate)
  const settlementBase = convertAmountAtRate(input.transactionAmount, input.settlementRate)
  return roundFx(settlementBase - originalBase)
}

export function computeUnrealizedAdjustment(input: {
  transactionBalance: number
  priorRate: number
  newRate: number
}): number {
  const priorBase = convertAmountAtRate(input.transactionBalance, input.priorRate)
  const newBase = convertAmountAtRate(input.transactionBalance, input.newRate)
  return roundFx(newBase - priorBase)
}
