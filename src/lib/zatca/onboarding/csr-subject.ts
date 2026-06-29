import type { ZatcaCsrSubjectInput } from './types'

import { resolveBusinessCategory } from '../business-categories'

const SOLUTION_NAME = 'hisab.ai'
const DEFAULT_INVOICE_TYPES = '1100'
const DEFAULT_EGS_MODEL = 'hisab.ai'
const OID_ORGANIZATION_IDENTIFIER = '2.5.4.97'

/** Strips PEM armor — base64 of the DER body only (NOT what ZATCA expects). */
export function csrPemToBase64(csrPem: string): string {
  return csrPem
    .replace(/-----BEGIN CERTIFICATE REQUEST-----/g, '')
    .replace(/-----END CERTIFICATE REQUEST-----/g, '')
    .replace(/\s+/g, '')
}

/**
 * Base64 of the FULL PEM string (including BEGIN/END armor and newlines).
 * This is the exact format the ZATCA compliance API expects in the `csr` field.
 */
export function csrPemToZatcaBase64(csrPem: string): string {
  const normalized = csrPem.replace(/\r\n/g, '\n').trim() + '\n'
  return Buffer.from(normalized, 'utf8').toString('base64')
}

export function sanitizePrintable(value: string): string {
  return value
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function formatOrganizationIdentifier(crNumber: string): string {
  const digits = crNumber.replace(/\D/g, '')
  return digits ? `CRN${digits}` : ''
}

export function resolveCommonName(input: ZatcaCsrSubjectInput): string {
  const vat = input.vatNumber.replace(/\D/g, '')
  // ZATCA Fatoora: simulation CN = TST-{VAT}, production CN = VAT (never a random device name)
  if (input.environment === 'SANDBOX') {
    return `TST-${vat}`
  }
  return vat
}

export interface CsrSubjectValues {
  vat: string
  crn: string
  organizationIdentifier: string
  solutionName: string
  egsModel: string
  egsSerialNumber: string
  organizationName: string
  organizationUnit: string
  commonName: string
  registeredAddress: string
  businessCategory: string
  invoiceTypes: string
}

export function buildCsrSubjectValues(input: ZatcaCsrSubjectInput): CsrSubjectValues {
  const vat = input.vatNumber.replace(/\D/g, '')
  if (vat.length !== 15) {
    throw new Error('VAT registration number must be 15 digits for ZATCA CSR generation')
  }

  const crn = input.commercialRegistration?.replace(/\D/g, '') ?? ''
  if (!crn) {
    throw new Error('Commercial Registration (CR) number is required for ZATCA CSR generation')
  }

  const solutionName = sanitizePrintable(input.solutionName?.trim() || SOLUTION_NAME)
  const egsModel = sanitizePrintable(input.egsModel?.trim() || DEFAULT_EGS_MODEL)
  const egsSerialNumber = sanitizePrintable(
    input.egsSerialNumber?.trim() || `${vat.slice(-6)}-${Date.now().toString(36)}`,
  )

  return {
    vat,
    crn,
    organizationIdentifier: formatOrganizationIdentifier(crn),
    solutionName,
    egsModel,
    egsSerialNumber,
    organizationName: sanitizePrintable(input.organizationName.trim()),
    organizationUnit: sanitizePrintable(input.organizationUnit?.trim() || 'Main Branch'),
    commonName: resolveCommonName(input),
    registeredAddress: sanitizePrintable(input.registeredAddress?.trim() || 'Riyadh'),
    businessCategory: sanitizePrintable(resolveBusinessCategory(input.businessCategory)),
    invoiceTypes: sanitizePrintable(input.invoiceTypes || DEFAULT_INVOICE_TYPES),
  }
}

export { OID_ORGANIZATION_IDENTIFIER }
