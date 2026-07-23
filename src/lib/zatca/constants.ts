import type { InvoiceType, ZatcaEnvironment } from '@/lib/db/prisma-types'
import type { ZatcaDocumentProfile, ZatcaInvoiceTypeCode } from './types'

/** UBL 2.1 root namespace */
export const UBL_INVOICE_NS = 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2'

/**
 * BT-23 / cbc:ProfileID value required by ZATCA for all UBL invoices.
 * @see ZATCA Electronic Invoice XML Implementation Standard (19 May 2023)
 *      §13.3.4 KSA – EN16931 — BR-KSA-EN16931-01:
 *      Business process (BT-23) / ubl:Invoice/cbc:ProfileID must be "reporting:1.0".
 *
 * Clearance vs reporting submission is NOT encoded in ProfileID; it is determined by
 * InvoiceTypeCode @name (01… → clearance API, 02… → reporting API).
 */
export const ZATCA_DOCUMENT_PROFILE: ZatcaDocumentProfile = 'reporting:1.0'

/** @deprecated Use ZATCA_DOCUMENT_PROFILE — ProfileID is always reporting:1.0 (BR-KSA-EN16931-01). */
export const ZATCA_PROFILE_BY_TYPE: Record<
  'STANDARD' | 'SIMPLIFIED' | 'CREDIT_NOTE' | 'DEBIT_NOTE',
  ZatcaDocumentProfile
> = {
  STANDARD: ZATCA_DOCUMENT_PROFILE,
  SIMPLIFIED: ZATCA_DOCUMENT_PROFILE,
  CREDIT_NOTE: ZATCA_DOCUMENT_PROFILE,
  DEBIT_NOTE: ZATCA_DOCUMENT_PROFILE,
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

/**
 * Resolves cbc:ProfileID (BT-23).
 *
 * Per BR-KSA-EN16931-01 this is always `reporting:1.0` for Standard, Simplified,
 * credit/debit notes, in both Sandbox and Production. Optional override is retained
 * only for explicit test/compliance fixtures.
 */
export function resolveZatcaProfileId(
  _invoiceType?: InvoiceTypeKey,
  _environment: ZatcaEnvironment = 'SANDBOX',
  profileIdOverride?: ZatcaDocumentProfile,
): ZatcaDocumentProfile {
  if (profileIdOverride) return profileIdOverride
  return ZATCA_DOCUMENT_PROFILE
}

/** Production routes standard invoices to clearance; simplified/credit/debit use reporting. */
export function resolveZatcaSubmissionRoute(
  invoiceType: InvoiceType,
  _environment: ZatcaEnvironment = 'SANDBOX',
  invoiceTypeCodeName?: string,
): 'clearance' | 'reporting' {
  const codeName = invoiceTypeCodeName ?? ZATCA_INVOICE_TYPE_NAME[invoiceType as InvoiceTypeKey]
  if (codeName.startsWith('01')) return 'clearance'
  return 'reporting'
}
