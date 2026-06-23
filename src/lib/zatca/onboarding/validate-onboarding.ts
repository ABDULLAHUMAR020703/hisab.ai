import type { CompanySettings, ZatcaCredential, ZatcaEnvironment } from '@/lib/db/prisma-types'

export interface OnboardingValidationResult {
  valid: boolean
  errors: string[]
}

export function validateCompanyProfileForZatca(
  settings: Pick<
    CompanySettings,
    | 'companyName'
    | 'legalName'
    | 'taxId'
    | 'commercialRegistration'
    | 'zatcaEnvironment'
    | 'city'
    | 'buildingNumber'
    | 'streetAddress'
    | 'address'
    | 'district'
    | 'postalCode'
  >,
  options?: { requireOtp?: boolean; otp?: string },
): OnboardingValidationResult {
  const errors: string[] = []

  const companyName = (settings.legalName || settings.companyName)?.trim()
  if (!companyName) {
    errors.push('Legal company name is required for ZATCA onboarding.')
  }

  const vat = settings.taxId?.replace(/\D/g, '') ?? ''
  if (vat.length !== 15) {
    errors.push('VAT registration number must be exactly 15 digits.')
  } else if (!vat.startsWith('3') || !vat.endsWith('3')) {
    errors.push('VAT registration number must start and end with digit 3 (ZATCA TRN format).')
  }

  const cr = settings.commercialRegistration?.replace(/\D/g, '') ?? ''
  if (!cr) {
    errors.push('Commercial Registration (CR) number is required.')
  }

  if (!settings.city?.trim()) {
    errors.push('City is required for the Saudi registered address.')
  }

  if (!settings.buildingNumber?.trim() && !settings.streetAddress?.trim() && !settings.address?.trim()) {
    errors.push('Building number or street address is required for the Saudi registered address.')
  }

  if (options?.requireOtp && !options.otp?.trim()) {
    errors.push('OTP from the Fatoora portal is required.')
  }

  return { valid: errors.length === 0, errors }
}

/** @deprecated Use validateCompanyProfileForZatca */
export const validateOnboardingState = validateCompanyProfileForZatca

export function isAlreadyConnected(credential: ZatcaCredential | null): boolean {
  if (!credential) return false
  return (
    credential.onboardingStatus === 'COMPLIANCE_ISSUED'
    || credential.onboardingStatus === 'COMPLIANCE_VALIDATED'
    || credential.onboardingStatus === 'PRODUCTION_ISSUED'
    || credential.onboardingStatus === 'PRODUCTION_READY'
  )
}

export function resolveConnectionLabel(
  zatcaConnected: boolean,
  onboardingStatus: string,
): 'NOT_CONNECTED' | 'PENDING' | 'CONNECTED' | 'FAILED' {
  if (onboardingStatus === 'FAILED') return 'FAILED'
  if (
    zatcaConnected
    && (
      onboardingStatus === 'COMPLIANCE_ISSUED'
      || onboardingStatus === 'COMPLIANCE_VALIDATED'
      || onboardingStatus === 'PRODUCTION_ISSUED'
      || onboardingStatus === 'PRODUCTION_READY'
    )
  ) {
    return 'CONNECTED'
  }
  if (onboardingStatus === 'CSR_GENERATED') return 'PENDING'
  return 'NOT_CONNECTED'
}

export function resolveActiveEnvironment(
  settingsEnvironment: ZatcaEnvironment,
  override?: ZatcaEnvironment,
): ZatcaEnvironment {
  return override ?? settingsEnvironment
}
