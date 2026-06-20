import type { ZatcaEnvironment } from '@prisma/client'

export type OnboardingErrorCode =
  | 'INVALID_OTP'
  | 'OTP_EXPIRED'
  | 'INVALID_CSR'
  | 'API_TIMEOUT'
  | 'INVALID_COMPANY_DATA'
  | 'CERTIFICATE_FAILURE'
  | 'DATABASE_FAILURE'
  | 'DUPLICATE_ONBOARDING'
  | 'UNAUTHORIZED'
  | 'UNKNOWN'

export interface OnboardingErrorView {
  code: OnboardingErrorCode
  message: string
  httpStatus: number
}

const OTP_PATTERNS = [/invalid.?otp/i, /otp.*invalid/i, /invalid-otp/i]
const OTP_EXPIRED_PATTERNS = [/otp.*expir/i, /expired.?otp/i]
const CSR_PATTERNS = [/invalid.?csr/i, /csr.*invalid/i]
const TIMEOUT_PATTERNS = [/timeout/i, /ETIMEDOUT/i, /fetch failed/i]
const CERT_PATTERNS = [/certificate/i, /public key/i, /x509/i]

export interface OnboardingErrorContext {
  environment?: ZatcaEnvironment
}

export function mapOnboardingError(
  error: unknown,
  context?: OnboardingErrorContext,
): OnboardingErrorView {
  const raw = error instanceof Error ? error.message : String(error)

  if (raw === 'Unauthorized') {
    return { code: 'UNAUTHORIZED', message: 'Please sign in again to continue ZATCA onboarding.', httpStatus: 401 }
  }

  if (OTP_EXPIRED_PATTERNS.some((p) => p.test(raw))) {
    return {
      code: 'OTP_EXPIRED',
      message: 'The OTP has expired. Generate a new OTP from the Fatoora portal and try again.',
      httpStatus: 422,
    }
  }

  if (OTP_PATTERNS.some((p) => p.test(raw))) {
    return {
      code: 'INVALID_OTP',
      message: 'Invalid OTP. Check the code from the Fatoora portal and ensure it matches the selected environment.',
      httpStatus: 422,
    }
  }

  if (CSR_PATTERNS.some((p) => p.test(raw))) {
    if (context?.environment === 'PRODUCTION') {
      return {
        code: 'INVALID_CSR',
        message:
          `${raw} In PRODUCTION a structurally valid CSR is rejected as Invalid-CSR when ZATCA cannot match it to an active taxpayer. Verify: (1) this VAT has been moved into an active ZATCA Phase-2 Integration wave (a live VAT registration alone is not enough), (2) the OTP was generated in the PRODUCTION Fatoora portal (fatoora.zatca.gov.sa) for this exact VAT/EGS unit and is unused, and (3) Legal Name, VAT, CR, and the Saudi address match the ERAD registration exactly.`,
        httpStatus: 422,
      }
    }
    return {
      code: 'INVALID_CSR',
      message:
        `${raw} Check that Legal Name, VAT (15 digits), CR, and Saudi address exactly match your ZATCA/Fatoora registration, and that the OTP was generated in the matching (simulation) portal.`,
      httpStatus: 422,
    }
  }

  if (TIMEOUT_PATTERNS.some((p) => p.test(raw))) {
    return {
      code: 'API_TIMEOUT',
      message: 'ZATCA did not respond in time. Please try again in a few minutes.',
      httpStatus: 504,
    }
  }

  if (CERT_PATTERNS.some((p) => p.test(raw)) && !CSR_PATTERNS.some((p) => p.test(raw))) {
    return {
      code: 'CERTIFICATE_FAILURE',
      message: 'Certificate processing failed. Regenerate CSR and request a fresh OTP.',
      httpStatus: 422,
    }
  }

  if (/VAT registration number must be 15 digits/i.test(raw) || /commercial registration|CRN|taxId|company settings not found/i.test(raw)) {
    return {
      code: 'INVALID_COMPANY_DATA',
      message: raw,
      httpStatus: 400,
    }
  }

  if (/already.*onboard|duplicate/i.test(raw)) {
    return {
      code: 'DUPLICATE_ONBOARDING',
      message: 'This environment is already connected to ZATCA. Use Refresh Status or switch environment.',
      httpStatus: 409,
    }
  }

  if (/prisma|database|SQLITE/i.test(raw)) {
    return {
      code: 'DATABASE_FAILURE',
      message: 'Could not save ZATCA credentials. Check database connectivity and try again.',
      httpStatus: 500,
    }
  }

  return { code: 'UNKNOWN', message: raw, httpStatus: 422 }
}
