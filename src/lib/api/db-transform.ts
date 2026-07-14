export function toCamel<T = Record<string, unknown>>(value: unknown): T {
  if (Array.isArray(value)) return value.map((item) => toCamel(item)) as T
  if (!value || typeof value !== 'object' || value instanceof Date) return value as T

  const out: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    const camelKey = key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())
    out[camelKey] = toCamel(val)
  }
  return out as T
}

export interface PurchaseLineInput {
  description: string
  quantity: number
  unitPrice: number
  taxRate: number
  accountId?: string
}

export function processPurchaseLines(lines: PurchaseLineInput[]) {
  let subtotal = 0
  let taxAmount = 0
  const processed = lines.map((line) => {
    const quantity = Number(line.quantity) || 0
    const unitPrice = Number(line.unitPrice) || 0
    const taxRate = Number(line.taxRate) || 0
    const amount = quantity * unitPrice
    const lineTax = amount * (taxRate / 100)
    subtotal += amount
    taxAmount += lineTax
    return {
      description: line.description,
      quantity,
      unit_price: unitPrice,
      tax_rate: taxRate,
      amount,
      account_id: line.accountId || null,
    }
  })
  return { subtotal, taxAmount, total: subtotal + taxAmount, processed }
}
