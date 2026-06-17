import type { InvoiceType } from '@prisma/client'
import {
  mergeValidationResults,
  validateZatcaDocument,
  validateZatcaInvoiceInput,
} from '../xml/validator'
import type {
  ZatcaCompanySettingsInput,
  ZatcaCustomerInput,
  ZatcaInvoiceInput,
  ZatcaValidationIssue,
  ZatcaValidationResult,
} from '../types'
import { SAUDI_VAT_TRN_LENGTH } from '../constants'

function error(code: string, field: string, message: string): ZatcaValidationIssue {
  return { code, field, message, severity: 'error' }
}

function isSaudiVatTrn(value: string): boolean {
  const digits = value.replace(/\D/g, '')
  return digits.length === SAUDI_VAT_TRN_LENGTH && /^\d{15}$/.test(digits)
}

function hasAddress(
  source: { streetAddress?: string | null; address?: string | null; city?: string | null },
): boolean {
  return Boolean(source.streetAddress?.trim() || source.address?.trim() || source.city?.trim())
}

/** Strict company validation for ZATCA submission */
export function validateCompanyForZatca(settings: ZatcaCompanySettingsInput): ZatcaValidationResult {
  const errors: ZatcaValidationIssue[] = []

  if (!settings.taxId?.trim()) {
    errors.push(error('COMPANY_VAT_REQUIRED', 'companySettings.taxId', 'Company VAT registration number (TRN) is required'))
  } else if (!isSaudiVatTrn(settings.taxId)) {
    errors.push(error('COMPANY_VAT_FORMAT', 'companySettings.taxId', `VAT TRN must be ${SAUDI_VAT_TRN_LENGTH} digits`))
  }

  if (!settings.commercialRegistration?.trim()) {
    errors.push(error('COMPANY_CRN_REQUIRED', 'companySettings.commercialRegistration', 'Commercial registration number (CRN) is required'))
  }

  if (!hasAddress(settings)) {
    errors.push(error('COMPANY_ADDRESS_REQUIRED', 'companySettings.streetAddress', 'Company street address or city is required'))
  }

  if (!settings.postalCode?.trim() && !settings.city?.trim()) {
    errors.push(error('COMPANY_POSTAL_REQUIRED', 'companySettings.postalCode', 'Postal code or city is required'))
  }

  return { valid: errors.length === 0, errors, warnings: [] }
}

/** Strict customer validation for ZATCA submission */
export function validateCustomerForZatca(
  customer: ZatcaCustomerInput,
  invoiceType: InvoiceType,
): ZatcaValidationResult {
  const errors: ZatcaValidationIssue[] = []

  if (invoiceType === 'STANDARD') {
    if (!customer.taxId?.trim()) {
      errors.push(error('CUSTOMER_VAT_REQUIRED', 'customer.taxId', 'Customer VAT TRN is required for standard invoices'))
    } else if (!isSaudiVatTrn(customer.taxId)) {
      errors.push(error('CUSTOMER_VAT_FORMAT', 'customer.taxId', `Customer VAT TRN must be ${SAUDI_VAT_TRN_LENGTH} digits`))
    }
  }

  if (!hasAddress(customer)) {
    errors.push(error('CUSTOMER_ADDRESS_REQUIRED', 'customer.streetAddress', 'Customer address is required'))
  }

  return { valid: errors.length === 0, errors, warnings: [] }
}

/** Strict invoice field validation before submission */
export function validateInvoiceFieldsForSubmission(input: ZatcaInvoiceInput): ZatcaValidationResult {
  const errors: ZatcaValidationIssue[] = []

  if (!input.invoiceUUID?.trim()) {
    errors.push(error('INV_UUID_REQUIRED', 'invoice.invoiceUUID', 'Invoice UUID is required for submission'))
  }

  if (!input.currency?.trim()) {
    errors.push(error('INV_CURRENCY_REQUIRED', 'invoice.currency', 'Invoice currency is required'))
  } else if (input.currency !== 'SAR') {
    errors.push(error('INV_CURRENCY_SAR', 'invoice.currency', 'Invoice currency must be SAR for ZATCA submission'))
  }

  if (!input.issueTime?.trim()) {
    errors.push(error('INV_ISSUE_TIME_REQUIRED', 'invoice.issueTime', 'Invoice issue time is required'))
  }

  if (input.subtotal <= 0) {
    errors.push(error('INV_SUBTOTAL_REQUIRED', 'invoice.subtotal', 'Invoice subtotal must be greater than zero'))
  }

  if (input.taxAmount < 0) {
    errors.push(error('INV_VAT_INVALID', 'invoice.taxAmount', 'Invoice VAT amount is invalid'))
  }

  if (input.total <= 0) {
    errors.push(error('INV_TOTAL_REQUIRED', 'invoice.total', 'Invoice total must be greater than zero'))
  }

  const lineSubtotal = input.lines.reduce((s, l) => s + l.amount, 0)
  const lineTax = input.lines.reduce((s, l) => s + l.amount * (l.taxRate / 100), 0)
  if (Math.abs(lineSubtotal + lineTax - input.total) > 0.02) {
    errors.push(error('INV_TOTAL_MISMATCH', 'invoice.total', 'Invoice total does not match line amounts plus VAT'))
  }

  return { valid: errors.length === 0, errors, warnings: [] }
}

/** Validates submission prerequisites (credentials + environment) */
export function validateSubmissionReadiness(input: {
  zatcaEnabled: boolean
  hasCertificate: boolean
  environment?: string | null
}): ZatcaValidationResult {
  const errors: ZatcaValidationIssue[] = []

  if (!input.zatcaEnabled) {
    errors.push(error('ZATCA_DISABLED', 'settings.zatcaEnabled', 'ZATCA e-invoicing must be enabled'))
  }

  if (!input.hasCertificate) {
    errors.push(error('CREDENTIALS_MISSING', 'credentials.certificate', 'ZATCA credentials not found. Complete onboarding first.'))
  }

  if (!input.environment) {
    errors.push(error('ENVIRONMENT_REQUIRED', 'settings.zatcaEnvironment', 'ZATCA environment must be selected'))
  }

  return { valid: errors.length === 0, errors, warnings: [] }
}

/**
 * Full pre-submission validation across company, customer, invoice, and XML stages.
 */
export function validateFullSubmissionPipeline(
  input: ZatcaInvoiceInput,
  documentValidation: ReturnType<typeof validateZatcaDocument>,
): ZatcaValidationResult {
  return mergeValidationResults(
    validateZatcaInvoiceInput(input),
    validateCompanyForZatca(input.companySettings),
    validateCustomerForZatca(input.customer, input.invoiceType),
    validateInvoiceFieldsForSubmission(input),
    documentValidation,
  )
}
