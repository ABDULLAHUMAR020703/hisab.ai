import type { InvoiceType } from '@/lib/db/prisma-types'
import { SAUDI_VAT_TRN_LENGTH } from './constants'

/** Valid Saudi VAT TRN: 15 digits, starts and ends with 3. */
export function isValidSaudiVatTrn(value: string | null | undefined): boolean {
  const digits = (value ?? '').replace(/\D/g, '')
  return (
    digits.length === SAUDI_VAT_TRN_LENGTH
    && /^3\d{13}3$/.test(digits)
  )
}

/**
 * Classifies a sales invoice (388) from buyer VAT registration.
 * B2B with valid TRN => STANDARD (0100000); B2C / walk-in without TRN => SIMPLIFIED (0200000).
 */
export function classifySalesInvoiceType(customer: {
  taxId?: string | null
}): 'STANDARD' | 'SIMPLIFIED' {
  return isValidSaudiVatTrn(customer.taxId) ? 'STANDARD' : 'SIMPLIFIED'
}

/**
 * Resolves the effective ZATCA invoice type for XML, validation, and API routing.
 * Credit/debit notes keep their stored type; sales invoices derive from customer VAT.
 */
export function resolveZatcaInvoiceType(
  storedType: string,
  customer: { taxId?: string | null },
): InvoiceType {
  if (storedType === 'CREDIT_NOTE' || storedType === 'DEBIT_NOTE') {
    return storedType
  }
  return classifySalesInvoiceType(customer)
}

/** Maps standard/simplified ZATCA family to InvoiceTypeCode @name. */
export function zatcaFamilyToCodeName(family: 'STANDARD' | 'SIMPLIFIED'): string {
  return family === 'STANDARD' ? '0100000' : '0200000'
}

/**
 * Derives BT-3 InvoiceTypeCode @name from business facts — never from persisted XML metadata.
 * Sales invoices: invoice type + customer VAT.
 * Credit/debit notes: referenced parent tax invoice type + customer VAT.
 */
export function resolveZatcaInvoiceTypeCodeName(input: {
  invoiceType: InvoiceType
  customer?: { taxId?: string | null }
  referencedSourceInvoiceType?: string | null
}): string {
  if (input.invoiceType === 'STANDARD' || input.invoiceType === 'SIMPLIFIED') {
    return zatcaFamilyToCodeName(input.invoiceType)
  }

  if (input.invoiceType === 'CREDIT_NOTE' || input.invoiceType === 'DEBIT_NOTE') {
    if (!input.referencedSourceInvoiceType) {
      return zatcaFamilyToCodeName(classifySalesInvoiceType(input.customer ?? {}))
    }
    const parentFamily = resolveZatcaInvoiceType(
      input.referencedSourceInvoiceType,
      input.customer ?? {},
    )
    if (parentFamily !== 'STANDARD' && parentFamily !== 'SIMPLIFIED') {
      return zatcaFamilyToCodeName(classifySalesInvoiceType(input.customer ?? {}))
    }
    return zatcaFamilyToCodeName(parentFamily)
  }

  return zatcaFamilyToCodeName(classifySalesInvoiceType(input.customer ?? {}))
}

export function isAdjustableTaxInvoice(invoiceType: string): boolean {
  return invoiceType === 'STANDARD' || invoiceType === 'SIMPLIFIED'
}
