export class ProductParityValidationError extends Error {
  constructor(message: string, readonly code: string) {
    super(message)
    this.name = 'ProductParityValidationError'
  }
}

export function money(value: unknown, field: string, options: { positive?: boolean; allowZero?: boolean } = {}) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new ProductParityValidationError(`${field} must be a number.`, 'INVALID_AMOUNT')
  const rounded = Math.round(parsed * 10000) / 10000
  if (options.positive && (rounded < 0 || (!options.allowZero && rounded === 0))) {
    throw new ProductParityValidationError(`${field} must be ${options.allowZero ? 'zero or greater' : 'greater than zero'}.`, 'INVALID_AMOUNT')
  }
  return rounded
}

export function requiredText(value: unknown, field: string, max = 500) {
  const result = typeof value === 'string' ? value.trim() : ''
  if (!result) throw new ProductParityValidationError(`${field} is required.`, 'REQUIRED_FIELD')
  if (result.length > max) throw new ProductParityValidationError(`${field} exceeds ${max} characters.`, 'FIELD_TOO_LONG')
  return result
}

export function validDate(value: unknown, field: string) {
  const date = new Date(String(value ?? ''))
  if (Number.isNaN(date.getTime())) throw new ProductParityValidationError(`${field} is invalid.`, 'INVALID_DATE')
  return date
}

export interface RefundLineInput {
  description: string
  quantity: number
  unitPrice: number
  taxRate: number
  accountId?: string | null
  inventoryItemId?: string | null
  costCenterId?: string | null
  sourceInvoiceLineId?: string | null
}

export function calculateRefund(lines: unknown): { lines: RefundLineInput[]; subtotal: number; taxAmount: number; total: number } {
  if (!Array.isArray(lines) || lines.length === 0) throw new ProductParityValidationError('At least one refund line is required.', 'LINES_REQUIRED')
  const normalized = lines.map((raw, index) => {
    const row = (raw ?? {}) as Record<string, unknown>
    const quantity = money(row.quantity ?? 1, `Line ${index + 1} quantity`, { positive: true })
    const unitPrice = money(row.unitPrice, `Line ${index + 1} unit price`, { positive: true, allowZero: true })
    const taxRate = money(row.taxRate ?? 0, `Line ${index + 1} tax rate`, { positive: true, allowZero: true })
    if (taxRate > 100) throw new ProductParityValidationError(`Line ${index + 1} tax rate cannot exceed 100%.`, 'INVALID_TAX_RATE')
    return {
      description: requiredText(row.description, `Line ${index + 1} description`), quantity, unitPrice, taxRate,
      accountId: typeof row.accountId === 'string' ? row.accountId : null,
      inventoryItemId: typeof row.inventoryItemId === 'string' ? row.inventoryItemId : null,
      costCenterId: typeof row.costCenterId === 'string' ? row.costCenterId : null,
      sourceInvoiceLineId: typeof row.sourceInvoiceLineId === 'string' ? row.sourceInvoiceLineId : null,
    }
  })
  const subtotal = money(normalized.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0), 'Subtotal')
  const taxAmount = money(normalized.reduce((sum, line) => sum + line.quantity * line.unitPrice * line.taxRate / 100, 0), 'Tax')
  return { lines: normalized, subtotal, taxAmount, total: money(subtotal + taxAmount, 'Total') }
}

export function calculateBillableMargin(cost: number, billed: number) {
  const margin = billed - cost
  return { cost, billed, margin, marginPercent: billed === 0 ? 0 : Math.round((margin / billed) * 10000) / 100 }
}
