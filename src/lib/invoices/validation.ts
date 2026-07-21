import { isValidTaxCalculationMethod, type InvoiceTaxCalculationMethod } from './calculations'
import { DOCUMENT_MAX_BYTES, validateDocumentUpload } from '@/lib/security/document-upload'

export interface InvoiceLineValidationInput {
  description?: string
  quantity?: number
  unitPrice?: number
  taxRate?: number
  taxRateId?: string | null
}

export interface InvoicePayloadValidationInput {
  customerId?: string
  date?: string
  dueDate?: string
  expiryDate?: string | null
  taxCalculationMethod?: string
  lines?: InvoiceLineValidationInput[]
  paymentTermId?: string | null
  terms?: string | null
}

export function validateTaxPercentage(rate: number): string | null {
  if (!Number.isFinite(rate)) return 'Tax percentage must be a number'
  if (rate < 0 || rate > 100) return 'Tax percentage must be between 0 and 100'
  return null
}

export function validateExpiryDate(
  invoiceDate: string | Date,
  expiryDate: string | Date | null | undefined,
): string | null {
  if (expiryDate == null || expiryDate === '') return null
  const inv = new Date(invoiceDate)
  const exp = new Date(expiryDate)
  if (Number.isNaN(inv.getTime())) return 'Invalid invoice date'
  if (Number.isNaN(exp.getTime())) return 'Invalid expiry date'
  const invDay = inv.toISOString().slice(0, 10)
  const expDay = exp.toISOString().slice(0, 10)
  if (expDay < invDay) return 'Expiry date cannot be before invoice date'
  return null
}

export function validateInvoicePayload(input: InvoicePayloadValidationInput): string | null {
  if (!input.customerId?.trim()) return 'customerId is required'
  if (!input.date) return 'date is required'
  if (!input.dueDate) return 'dueDate is required'
  if (!input.lines?.length) return 'At least one line is required'

  if (input.taxCalculationMethod != null && !isValidTaxCalculationMethod(input.taxCalculationMethod)) {
    return 'Invalid taxCalculationMethod'
  }

  const expiryError = validateExpiryDate(input.date, input.expiryDate)
  if (expiryError) return expiryError

  for (let i = 0; i < input.lines.length; i++) {
    const line = input.lines[i]
    if (!line.description?.trim() && !(line as { itemName?: string }).itemName) {
      // Allow empty description if item present — still require some label
    }
    const qty = Number(line.quantity)
    if (!Number.isFinite(qty) || qty < 0) return `Line ${i + 1}: quantity must be >= 0`
    const price = Number(line.unitPrice)
    if (!Number.isFinite(price) || price < 0) return `Line ${i + 1}: unitPrice must be >= 0`
    if (line.taxRate != null) {
      const taxErr = validateTaxPercentage(Number(line.taxRate))
      if (taxErr) return `Line ${i + 1}: ${taxErr}`
    }
  }

  return null
}

export function validateTaxConfigurationInput(input: {
  name?: string
  percentage?: number
  category?: string
  zatcaMapping?: string
}): string | null {
  if (!input.name?.trim()) return 'name is required'
  if (input.percentage == null || !Number.isFinite(Number(input.percentage))) {
    return 'percentage is required'
  }
  const pctErr = validateTaxPercentage(Number(input.percentage))
  if (pctErr) return pctErr

  const validMappings = ['STANDARD_RATED', 'ZERO_RATED', 'EXEMPT', 'OUTSIDE_SCOPE']
  if (input.zatcaMapping && !validMappings.includes(input.zatcaMapping)) {
    return 'Invalid zatcaMapping'
  }
  return null
}

export function validateInvoiceAttachmentUpload(file: File): string | null {
  return validateDocumentUpload(file)
}

export { DOCUMENT_MAX_BYTES }

export function normalizeTaxCalculationMethod(
  value: unknown,
): InvoiceTaxCalculationMethod {
  if (isValidTaxCalculationMethod(value)) return value
  return 'TAX_EXCLUSIVE'
}
