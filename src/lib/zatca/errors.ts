export type ZatcaErrorCode =
  | 'MISSING_CREDENTIALS'
  | 'EXPIRED_CREDENTIALS'
  | 'INVALID_XML'
  | 'INVALID_SIGNATURE'
  | 'VALIDATION_FAILED'
  | 'QR_VALIDATION_FAILED'
  | 'ZATCA_API_FAILURE'
  | 'ZATCA_TIMEOUT'
  | 'ZATCA_DISABLED'
  | 'INVOICE_NOT_FOUND'
  | 'ALREADY_SUBMITTED'
  | 'UNKNOWN'

export class ZatcaError extends Error {
  readonly code: ZatcaErrorCode
  readonly diagnostic: string

  constructor(code: ZatcaErrorCode, message: string, diagnostic?: string) {
    super(message)
    this.name = 'ZatcaError'
    this.code = code
    this.diagnostic = diagnostic ?? message
  }
}

export function mapToZatcaError(error: unknown): ZatcaError {
  if (error instanceof ZatcaError) return error

  const message = error instanceof Error ? error.message : String(error)
  const lower = message.toLowerCase()

  if (lower.includes('credential') || lower.includes('onboarding')) {
    return new ZatcaError('MISSING_CREDENTIALS', message)
  }
  if (lower.includes('expired')) {
    return new ZatcaError('EXPIRED_CREDENTIALS', message)
  }
  if (lower.includes('signature')) {
    return new ZatcaError('INVALID_SIGNATURE', message)
  }
  if (lower.includes('xml') || lower.includes('ubl')) {
    return new ZatcaError('INVALID_XML', message)
  }
  if (lower.includes('validation')) {
    return new ZatcaError('VALIDATION_FAILED', message)
  }
  if (lower.includes('timeout') || lower.includes('aborted')) {
    return new ZatcaError('ZATCA_TIMEOUT', message)
  }
  if (lower.includes('zatca') && (lower.includes('failed') || lower.includes('api'))) {
    return new ZatcaError('ZATCA_API_FAILURE', message)
  }

  return new ZatcaError('UNKNOWN', message)
}
