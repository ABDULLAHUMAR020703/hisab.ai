import type { PostingLine } from '@/lib/accounting/posting-service'

export function buildRefundPostingLines(input: { revenueLines: Array<{ accountId: string; amount: number; costCenterId?: string | null }>; taxAccountId?: string | null; bankAccountId: string; taxAmount: number; total: number; reference: string }): PostingLine[] {
  return [
    ...input.revenueLines.map(line => ({ accountId: line.accountId, debit: line.amount, costCenterId: line.costCenterId, description: `Refund ${input.reference}` })),
    ...(input.taxAmount > 0 && input.taxAccountId ? [{ accountId: input.taxAccountId, debit: input.taxAmount, description: `Tax reversal ${input.reference}` }] : []),
    { accountId: input.bankAccountId, credit: input.total, description: `Refund paid ${input.reference}` },
  ]
}

export function buildCreditCardPaymentPostingLines(input: { cardAccountId: string; bankAccountId: string; feeAccountId?: string | null; amount: number; feeAmount: number; reference: string }): PostingLine[] {
  return [
    { accountId: input.cardAccountId, debit: input.amount, description: `Credit-card payment ${input.reference}` },
    ...(input.feeAmount > 0 && input.feeAccountId ? [{ accountId: input.feeAccountId, debit: input.feeAmount, description: `Card fee ${input.reference}` }] : []),
    { accountId: input.bankAccountId, credit: input.amount + input.feeAmount, description: `Bank payment ${input.reference}` },
  ]
}

export function buildTaxSettlementPostingLines(input: { type: 'PAYMENT' | 'REFUND'; taxAccountId: string; bankAccountId: string; amount: number; reference: string }): PostingLine[] {
  return input.type === 'PAYMENT'
    ? [{ accountId: input.taxAccountId, debit: input.amount, description: `Tax payment ${input.reference}` }, { accountId: input.bankAccountId, credit: input.amount, description: `Tax payment ${input.reference}` }]
    : [{ accountId: input.bankAccountId, debit: input.amount, description: `Tax refund ${input.reference}` }, { accountId: input.taxAccountId, credit: input.amount, description: `Tax refund ${input.reference}` }]
}

export function postingTotals(lines: PostingLine[]) {
  return lines.reduce((totals, line) => ({ debit: totals.debit + Number(line.debit ?? 0), credit: totals.credit + Number(line.credit ?? 0) }), { debit: 0, credit: 0 })
}
