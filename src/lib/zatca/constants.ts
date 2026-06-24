import type { ZatcaDocumentProfile, ZatcaInvoiceTypeCode } from './types'

/** UBL 2.1 root namespace */
export const UBL_INVOICE_NS = 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2'

/** ZATCA document profile by invoice classification */
export const ZATCA_PROFILE_BY_TYPE: Record<
  'STANDARD' | 'SIMPLIFIED' | 'CREDIT_NOTE' | 'DEBIT_NOTE',
  ZatcaDocumentProfile
> = {
  STANDARD: 'clearance:1.0',
  SIMPLIFIED: 'reporting:1.0',
  CREDIT_NOTE: 'reporting:1.0',
  DEBIT_NOTE: 'reporting:1.0',
}

/** Base64 PIH seed for the first invoice in a device sequence (ZATCA spec). */
export const ZATCA_FIRST_PIH_BASE64 =
  'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ=='

/**
 * UN/CEFACT invoice type codes used by ZATCA.
 * @see ZATCA e-invoicing technical guidelines
 */
export const ZATCA_INVOICE_TYPE_CODE: Record<
  'STANDARD' | 'SIMPLIFIED' | 'CREDIT_NOTE' | 'DEBIT_NOTE',
  ZatcaInvoiceTypeCode
> = {
  STANDARD: '388',
  SIMPLIFIED: '388',
  CREDIT_NOTE: '381',
  DEBIT_NOTE: '383',
}

/**
 * ZATCA InvoiceTypeCode @name attribute (transaction type).
 * 0100000 = Standard tax invoice, 0200000 = Simplified tax invoice
 */
export const ZATCA_INVOICE_TYPE_NAME: Record<
  'STANDARD' | 'SIMPLIFIED' | 'CREDIT_NOTE' | 'DEBIT_NOTE',
  string
> = {
  STANDARD: '0100000',
  SIMPLIFIED: '0200000',
  CREDIT_NOTE: '0200000',
  DEBIT_NOTE: '0200000',
}

/** Default unit code — UN/ECE Rec 20 (piece) */
export const DEFAULT_UNIT_CODE = 'PCE'

/** Saudi VAT standard rate (%) */
export const SAUDI_VAT_RATE = 15

/** Saudi Arabia ISO 3166-1 alpha-2 */
export const SAUDI_COUNTRY_CODE = 'SA'

/** Amount tolerance for total reconciliation checks */
export const AMOUNT_TOLERANCE = 0.02

/** Saudi VAT TRN length */
export const SAUDI_VAT_TRN_LENGTH = 15

type InvoiceTypeKey = keyof typeof ZATCA_INVOICE_TYPE_NAME

export function resolveInvoiceTypeCodeName(input: {
  invoiceType: InvoiceTypeKey
  invoiceTypeCodeNameOverride?: string
}): string {
  return input.invoiceTypeCodeNameOverride ?? ZATCA_INVOICE_TYPE_NAME[input.invoiceType]
}

/** True when InvoiceTypeCode @name is 0100000 (standard tax invoice family). */
export function isStandardTaxInvoice(input: {
  invoiceType: InvoiceTypeKey
  invoiceTypeCodeNameOverride?: string
}): boolean {
  return resolveInvoiceTypeCodeName(input).startsWith('01')
}

/** True when InvoiceTypeCode @name is 0200000 (simplified tax invoice family). */
export function isSimplifiedTaxInvoice(input: {
  invoiceType: InvoiceTypeKey
  invoiceTypeCodeNameOverride?: string
}): boolean {
  return resolveInvoiceTypeCodeName(input).startsWith('02')
}
