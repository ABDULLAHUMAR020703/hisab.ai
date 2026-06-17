import type { ZatcaValidationIssue, ZatcaValidationResult } from '../types'

export interface QrPayloadInput {
  sellerName?: string | null
  vatNumber?: string | null
  timestamp?: string | null
  invoiceTotal?: number | null
  vatTotal?: number | null
}

export interface Phase2QrPayloadInput extends QrPayloadInput {
  invoiceHashBase64?: string | null
  digitalSignature?: string | null
  publicKey?: Buffer | null
  certificateSignature?: Buffer | null
}

function error(code: string, field: string, message: string): ZatcaValidationIssue {
  return { code, field, message, severity: 'error' }
}

/** Validates fields required for ZATCA TLV QR generation (Tags 1–5). */
export function validateQrPayloadInput(input: QrPayloadInput): ZatcaValidationResult {
  const errors: ZatcaValidationIssue[] = []

  if (!input.sellerName?.trim()) {
    errors.push(error('QR_SELLER_NAME_REQUIRED', 'sellerName', 'Seller name is required for QR generation'))
  }

  if (!input.vatNumber?.trim()) {
    errors.push(error('QR_VAT_REQUIRED', 'vatNumber', 'VAT registration number is required for QR generation'))
  }

  if (!input.timestamp?.trim()) {
    errors.push(error('QR_TIMESTAMP_REQUIRED', 'timestamp', 'Invoice timestamp is required for QR generation'))
  }

  if (input.invoiceTotal == null || Number.isNaN(input.invoiceTotal)) {
    errors.push(error('QR_TOTAL_REQUIRED', 'invoiceTotal', 'Invoice total is required for QR generation'))
  }

  if (input.vatTotal == null || Number.isNaN(input.vatTotal)) {
    errors.push(error('QR_VAT_TOTAL_REQUIRED', 'vatTotal', 'VAT total is required for QR generation'))
  }

  return { valid: errors.length === 0, errors, warnings: [] }
}

/** Validates Phase 2 QR fields including cryptographic tags 6–9. */
export function validatePhase2QrPayloadInput(input: Phase2QrPayloadInput): ZatcaValidationResult {
  const base = validateQrPayloadInput(input)
  const errors = [...base.errors]

  if (!input.invoiceHashBase64?.trim()) {
    errors.push(error('QR_INVOICE_HASH_REQUIRED', 'invoiceHashBase64', 'Signed invoice hash (tag 6) is required'))
  }

  if (!input.digitalSignature?.trim()) {
    errors.push(error('QR_SIGNATURE_REQUIRED', 'digitalSignature', 'Digital signature (tag 7) is required'))
  }

  if (!input.publicKey?.length) {
    errors.push(error('QR_PUBLIC_KEY_REQUIRED', 'publicKey', 'ECDSA public key (tag 8) is required'))
  }

  if (input.certificateSignature !== undefined && !input.certificateSignature?.length) {
    errors.push(error('QR_CA_SIGNATURE_REQUIRED', 'certificateSignature', 'CA certificate signature (tag 9) is required'))
  }

  return { valid: errors.length === 0, errors, warnings: [] }
}
