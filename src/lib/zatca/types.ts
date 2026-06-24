/**
 * ZATCA-oriented UBL 2.1 document types.
 * Internal representation before XML serialization (Day 2 — no signing/API).
 */

export type ZatcaDocumentProfile = 'clearance:1.0' | 'reporting:1.0'

export type ZatcaInvoiceTypeCode = '388' | '381' | '383'

export interface ZatcaPartyIdentification {
  id: string
  schemeId: 'CRN' | 'TIN' | 'NAT' | 'MOM' | 'MLS' | '700' | 'SAG' | 'OTH'
}

export interface ZatcaPostalAddress {
  streetName: string
  buildingNumber: string
  citySubdivisionName: string
  cityName: string
  postalZone: string
  countryCode: string
}

export interface ZatcaParty {
  registrationName: string
  /** VAT TRN rendered in PartyTaxScheme/CompanyID (not PartyIdentification). */
  vatNumber?: string
  identifications: ZatcaPartyIdentification[]
  postalAddress: ZatcaPostalAddress
  email?: string
  telephone?: string
}

export interface ZatcaTaxCategory {
  id: 'S' | 'Z' | 'E' | 'O'
  percent: number
  taxSchemeId: 'VAT'
}

export interface ZatcaTaxSubtotal {
  taxableAmount: number
  taxAmount: number
  category: ZatcaTaxCategory
}

export interface ZatcaTaxTotal {
  taxAmount: number
  subtotals: ZatcaTaxSubtotal[]
}

export interface ZatcaMonetaryTotal {
  lineExtensionAmount: number
  taxExclusiveAmount: number
  taxInclusiveAmount: number
  payableAmount: number
}

export interface ZatcaInvoiceLine {
  id: string
  quantity: number
  unitCode: string
  lineExtensionAmount: number
  taxAmount: number
  itemName: string
  unitPrice: number
  taxCategory: ZatcaTaxCategory
}

export interface ZatcaAdditionalDocumentReference {
  id: 'ICV' | 'PIH' | 'QR'
  uuid?: string
  embeddedContent?: string
}

export interface ZatcaInvoiceDocument {
  ublVersionId: '2.1'
  profileId: ZatcaDocumentProfile
  invoiceNumber: string
  uuid: string
  issueDate: string
  issueTime: string
  invoiceTypeCode: ZatcaInvoiceTypeCode
  invoiceTypeCodeName: string
  documentCurrencyCode: string
  taxCurrencyCode: string
  additionalDocumentReferences: ZatcaAdditionalDocumentReference[]
  supplier: ZatcaParty
  customer: ZatcaParty
  taxTotal: ZatcaTaxTotal
  legalMonetaryTotal: ZatcaMonetaryTotal
  invoiceLines: ZatcaInvoiceLine[]
  notes?: string
  /** Original invoice number for credit/debit notes (BR-KSA-56). */
  billingReferenceId?: string
}

export interface ZatcaValidationIssue {
  code: string
  field: string
  message: string
  severity: 'error' | 'warning'
}

export interface ZatcaValidationResult {
  valid: boolean
  errors: ZatcaValidationIssue[]
  warnings: ZatcaValidationIssue[]
}

export interface ZatcaXmlGenerationResult {
  xml: string
  document: ZatcaInvoiceDocument
  validation: ZatcaValidationResult
}

export interface ZatcaHashResult {
  invoiceId: string
  hash: string
  previousHash: string | null
}

export interface ZatcaQrResult {
  payload: string
  qrDataUrl: string
  validation: ZatcaValidationResult
}

/** Input shape for mapping from Prisma models */
export interface ZatcaInvoiceLineInput {
  id: string
  description: string
  quantity: number
  unitPrice: number
  taxRate: number
  amount: number
}

export interface ZatcaCustomerInput {
  name: string
  email?: string | null
  phone?: string | null
  address?: string | null
  streetAddress?: string | null
  buildingNumber?: string | null
  district?: string | null
  city?: string | null
  country?: string | null
  postalCode?: string | null
  taxId?: string | null
}

export interface ZatcaCompanySettingsInput {
  companyName: string
  legalName?: string | null
  taxId?: string | null
  commercialRegistration?: string | null
  address?: string | null
  streetAddress?: string | null
  buildingNumber?: string | null
  district?: string | null
  city?: string | null
  postalCode?: string | null
  country: string
  phone?: string | null
  email?: string | null
  currency: string
}

export interface ZatcaInvoiceInput {
  id: string
  invoiceNo: string
  invoiceUUID?: string | null
  invoiceType: 'STANDARD' | 'SIMPLIFIED' | 'CREDIT_NOTE' | 'DEBIT_NOTE'
  date: Date
  issueTime?: string | null
  currency: string
  subtotal: number
  taxAmount: number
  total: number
  notes?: string | null
  lines: ZatcaInvoiceLineInput[]
  customer: ZatcaCustomerInput
  companySettings: ZatcaCompanySettingsInput
  /** Invoice counter value (ICV) — monotonic per EGS device */
  invoiceCounterValue?: number
  /** Base64 PIH for AdditionalDocumentReference */
  previousInvoiceHashBase64?: string
  /** Base64 TLV QR payload for AdditionalDocumentReference (simplified / reporting) */
  qrPayloadBase64?: string
  /** Original invoice number for credit/debit notes (BR-KSA-56). */
  billingReferenceId?: string
  /** Optional profile override (e.g. compliance API requires reporting:1.0 for standard samples). */
  profileIdOverride?: ZatcaDocumentProfile
  /** Optional InvoiceTypeCode @name override (e.g. 0100000 standard credit/debit notes). */
  invoiceTypeCodeNameOverride?: string
}
