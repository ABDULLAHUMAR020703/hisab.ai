export interface JournalLineInput {
  accountId: string
  debit?: number
  credit?: number
  costCenterId?: string | null
  taxRate?: number
  description?: string
}

export class PostingValidationError extends Error {
  constructor(message: string, public code: string) {
    super(message)
    this.name = 'PostingValidationError'
  }
}

export function validateBalanced(lines: JournalLineInput[]): void {
  const totalDebit = lines.reduce((s, l) => s + (l.debit ?? 0), 0)
  const totalCredit = lines.reduce((s, l) => s + (l.credit ?? 0), 0)
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    throw new PostingValidationError('Debits must equal credits', 'UNBALANCED')
  }
  if (totalDebit <= 0) {
    throw new PostingValidationError('Entry must have non-zero amounts', 'ZERO_AMOUNT')
  }
}
