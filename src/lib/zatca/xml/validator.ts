import {
  AMOUNT_TOLERANCE,
  SAUDI_COUNTRY_CODE,
  SAUDI_VAT_TRN_LENGTH,
} from '../constants'
import type {
  ZatcaInvoiceDocument,
  ZatcaInvoiceInput,
  ZatcaValidationIssue,
  ZatcaValidationResult,
} from '../types'

function error(code: string, field: string, message: string): ZatcaValidationIssue {
  return { code, field, message, severity: 'error' }
}

function warning(code: string, field: string, message: string): ZatcaValidationIssue {
  return { code, field, message, severity: 'warning' }
}

function isValidUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function isValidDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))
}

function isValidTime(value: string): boolean {
  return /^\d{2}:\d{2}:\d{2}$/.test(value)
}

function isSaudiVatTrn(value: string): boolean {
  const digits = value.replace(/\D/g, '')
  return digits.length === SAUDI_VAT_TRN_LENGTH && /^\d{15}$/.test(digits)
}

function amountsClose(a: number, b: number): boolean {
  return Math.abs(a - b) <= AMOUNT_TOLERANCE
}

/** Validation rules applied to source invoice input before mapping */
export function validateZatcaInvoiceInput(input: ZatcaInvoiceInput): ZatcaValidationResult {
  const errors: ZatcaValidationIssue[] = []
  const warnings: ZatcaValidationIssue[] = []

  if (!input.invoiceNo?.trim()) {
    errors.push(error('INV_NUMBER_REQUIRED', 'invoice.invoiceNo', 'Invoice number is required'))
  }

  if (!input.lines?.length) {
    errors.push(error('INV_LINES_REQUIRED', 'invoice.lines', 'At least one invoice line is required'))
  }

  if (!input.customer?.name?.trim()) {
    errors.push(error('CUSTOMER_NAME_REQUIRED', 'customer.name', 'Customer name is required'))
  }

  const supplierName = input.companySettings.legalName || input.companySettings.companyName
  if (!supplierName?.trim()) {
    errors.push(error('SUPPLIER_NAME_REQUIRED', 'companySettings.companyName', 'Supplier legal name is required'))
  }

  if (!input.invoiceUUID?.trim()) {
    warnings.push(warning(
      'INV_UUID_MISSING',
      'invoice.invoiceUUID',
      'Invoice UUID is missing; a temporary UUID will be generated for XML output',
    ))
  }

  if (!input.companySettings.taxId?.trim()) {
    warnings.push(warning(
      'SUPPLIER_VAT_MISSING',
      'companySettings.taxId',
      'Supplier VAT registration number (TRN) is missing',
    ))
  } else if (!isSaudiVatTrn(input.companySettings.taxId)) {
    warnings.push(warning(
      'SUPPLIER_VAT_FORMAT',
      'companySettings.taxId',
      `Supplier VAT TRN should be ${SAUDI_VAT_TRN_LENGTH} digits for Saudi entities`,
    ))
  }

  if (!input.companySettings.commercialRegistration?.trim()) {
    warnings.push(warning(
      'SUPPLIER_CRN_MISSING',
      'companySettings.commercialRegistration',
      'Supplier commercial registration number (CRN) is missing',
    ))
  }

  if (input.invoiceType === 'STANDARD' && !input.customer.taxId?.trim()) {
    warnings.push(warning(
      'CUSTOMER_VAT_MISSING',
      'customer.taxId',
      'Buyer VAT TRN is recommended for standard (B2B) tax invoices',
    ))
  }

  if (input.currency && input.currency !== 'SAR') {
    warnings.push(warning(
      'CURRENCY_NOT_SAR',
      'invoice.currency',
      'ZATCA e-invoices for Saudi entities typically use SAR',
    ))
  }

  // Header subtotal/tax/total may lag the XML mapper (line-derived roundMoney totals).
  // Monetary integrity is enforced on the mapped document via validateProcessedMonetaryTotals /
  // validateZatcaDocument — do not recalculate VAT from amount × rate here.

  return { valid: errors.length === 0, errors, warnings }
}

/** Validation rules applied to the mapped UBL document before XML serialization */
export function validateZatcaDocument(document: ZatcaInvoiceDocument): ZatcaValidationResult {
  const errors: ZatcaValidationIssue[] = []
  const warnings: ZatcaValidationIssue[] = []

  if (document.ublVersionId !== '2.1') {
    errors.push(error('UBL_VERSION', 'ublVersionId', 'UBL version must be 2.1'))
  }

  if (!document.profileId) {
    errors.push(error('PROFILE_REQUIRED', 'profileId', 'ZATCA profile ID is required'))
  }

  if (!document.invoiceNumber) {
    errors.push(error('INV_NUMBER_REQUIRED', 'invoiceNumber', 'Invoice number is required'))
  }

  if (!document.uuid || !isValidUuid(document.uuid)) {
    errors.push(error('INV_UUID_INVALID', 'uuid', 'Invoice UUID must be a valid RFC 4122 UUID'))
  }

  if (!isValidDate(document.issueDate)) {
    errors.push(error('ISSUE_DATE_INVALID', 'issueDate', 'Issue date must be YYYY-MM-DD'))
  }

  if (!isValidTime(document.issueTime)) {
    errors.push(error('ISSUE_TIME_INVALID', 'issueTime', 'Issue time must be HH:mm:ss'))
  }

  if (!document.documentCurrencyCode) {
    errors.push(error('CURRENCY_REQUIRED', 'documentCurrencyCode', 'Document currency is required'))
  }

  if (!document.invoiceLines.length) {
    errors.push(error('INV_LINES_REQUIRED', 'invoiceLines', 'At least one invoice line is required'))
  }

  if (!document.supplier.registrationName) {
    errors.push(error('SUPPLIER_NAME_REQUIRED', 'supplier.registrationName', 'Supplier name is required'))
  }

  if (!document.customer.registrationName) {
    errors.push(error('CUSTOMER_NAME_REQUIRED', 'customer.registrationName', 'Customer name is required'))
  }

  if (!document.supplier.vatNumber) {
    warnings.push(warning('SUPPLIER_VAT_MISSING', 'supplier.vatNumber', 'Supplier VAT identification is missing'))
  }

  if (document.supplier.postalAddress.countryCode !== SAUDI_COUNTRY_CODE) {
    warnings.push(warning(
      'SUPPLIER_COUNTRY',
      'supplier.postalAddress.countryCode',
      'Supplier country is not SA (Saudi Arabia)',
    ))
  }

  const lineExtensionSum = document.invoiceLines.reduce((s, l) => s + l.lineExtensionAmount, 0)
  const lineTaxSum = document.invoiceLines.reduce((s, l) => s + l.taxAmount, 0)

  if (!amountsClose(lineExtensionSum, document.legalMonetaryTotal.lineExtensionAmount)) {
    warnings.push(warning(
      'LINE_EXTENSION_MISMATCH',
      'legalMonetaryTotal.lineExtensionAmount',
      'Line extension total does not match sum of invoice lines',
    ))
  }

  if (!amountsClose(lineTaxSum, document.taxTotal.taxAmount)) {
    warnings.push(warning(
      'TAX_TOTAL_MISMATCH',
      'taxTotal.taxAmount',
      'Tax total does not match sum of line taxes',
    ))
  }

  if (!amountsClose(
    document.legalMonetaryTotal.taxExclusiveAmount + document.taxTotal.taxAmount,
    document.legalMonetaryTotal.taxInclusiveAmount,
  )) {
    warnings.push(warning(
      'TAX_INCLUSIVE_MISMATCH',
      'legalMonetaryTotal.taxInclusiveAmount',
      'Tax inclusive amount does not equal tax exclusive amount plus tax',
    ))
  }

  return { valid: errors.length === 0, errors, warnings }
}

/** Merge input and document validation results */
export function mergeValidationResults(...results: ZatcaValidationResult[]): ZatcaValidationResult {
  const errors = results.flatMap((r) => r.errors)
  const warnings = results.flatMap((r) => r.warnings)
  return { valid: errors.length === 0, errors, warnings }
}
