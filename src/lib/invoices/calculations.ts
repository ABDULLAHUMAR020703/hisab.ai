import {
  calculateExclusiveTax,
  roundMoney,
  splitInclusiveAmount,
} from '@/lib/tax/calculator'

export type InvoiceTaxCalculationMethod =
  | 'TAX_EXCLUSIVE'
  | 'TAX_INCLUSIVE'
  | 'OUT_OF_SCOPE'

export interface InvoiceLineCalcInput {
  quantity: number
  unitPrice: number
  /** Tax percentage 0–100 (ignored when method is OUT_OF_SCOPE). */
  taxRate: number
}

export interface InvoiceLineCalcResult {
  quantity: number
  unitPrice: number
  taxRate: number
  /** Net / taxable amount stored on the line (`amount` column). */
  amount: number
  taxAmount: number
  /** Gross line total (net + tax for exclusive; entered price total for inclusive). */
  lineTotal: number
}

export interface InvoiceTotalsResult {
  lines: InvoiceLineCalcResult[]
  subtotal: number
  taxAmount: number
  total: number
}

/**
 * Calculate a single line under the invoice-level tax calculation method.
 *
 * TAX_EXCLUSIVE: unitPrice is net; tax added on top.
 * TAX_INCLUSIVE: unitPrice already includes tax; reverse out net + tax.
 * OUT_OF_SCOPE: no tax; taxRate treated as 0.
 */
export function calculateInvoiceLine(
  line: InvoiceLineCalcInput,
  method: InvoiceTaxCalculationMethod,
): InvoiceLineCalcResult {
  const quantity = Number(line.quantity) || 0
  const unitPrice = Number(line.unitPrice) || 0
  const entered = roundMoney(quantity * unitPrice)

  if (method === 'OUT_OF_SCOPE') {
    return {
      quantity,
      unitPrice,
      taxRate: 0,
      amount: entered,
      taxAmount: 0,
      lineTotal: entered,
    }
  }

  const taxRate = Math.max(0, Math.min(100, Number(line.taxRate) || 0))

  if (method === 'TAX_INCLUSIVE') {
    const { net, tax } = splitInclusiveAmount(entered, taxRate)
    return {
      quantity,
      unitPrice,
      taxRate,
      amount: net,
      taxAmount: tax,
      lineTotal: entered,
    }
  }

  // TAX_EXCLUSIVE
  const taxAmount = calculateExclusiveTax(entered, taxRate)
  return {
    quantity,
    unitPrice,
    taxRate,
    amount: entered,
    taxAmount,
    lineTotal: roundMoney(entered + taxAmount),
  }
}

export function calculateInvoiceTotals(
  lines: InvoiceLineCalcInput[],
  method: InvoiceTaxCalculationMethod = 'TAX_EXCLUSIVE',
): InvoiceTotalsResult {
  const calculated = lines.map((line) => calculateInvoiceLine(line, method))
  const subtotal = roundMoney(calculated.reduce((s, l) => s + l.amount, 0))
  const taxAmount = roundMoney(calculated.reduce((s, l) => s + l.taxAmount, 0))
  const total = roundMoney(calculated.reduce((s, l) => s + l.lineTotal, 0))
  return { lines: calculated, subtotal, taxAmount, total }
}

export function isValidTaxCalculationMethod(
  value: unknown,
): value is InvoiceTaxCalculationMethod {
  return (
    value === 'TAX_EXCLUSIVE' ||
    value === 'TAX_INCLUSIVE' ||
    value === 'OUT_OF_SCOPE'
  )
}
