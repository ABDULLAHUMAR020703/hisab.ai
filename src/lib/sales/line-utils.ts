import 'server-only'

export interface SalesLineInput {
  description: string
  quantity: number
  unitPrice: number
  taxRate: number
  taxRateId?: string | null
  taxGroupId?: string | null
  accountId?: string | null
}

export interface ProcessedSalesLine {
  description: string
  quantity: number
  unitPrice: number
  taxRate: number
  amount: number
  accountId: string | null
}

import { computeLegacyLineTax } from '@/lib/tax/calculator'

export function processSalesLines(lines: SalesLineInput[]) {
  let subtotal = 0
  let taxAmount = 0
  const processedLines: ProcessedSalesLine[] = lines.map((line) => {
    const result = computeLegacyLineTax(line.quantity, line.unitPrice, Number(line.taxRate))
    subtotal += result.netAmount
    taxAmount += result.taxAmount
    return {
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      taxRate: result.effectiveTaxRate,
      amount: result.netAmount,
      accountId: line.accountId || null,
    }
  })
  return { processedLines, subtotal, taxAmount, total: subtotal + taxAmount }
}
