import 'server-only'

/** Mock modes must never run in production deployments. */
export function assertZatcaMocksDisabled(): void {
  if (process.env.NODE_ENV !== 'production') return
  if (process.env.ZATCA_MOCK_ONBOARDING === 'true' || process.env.ZATCA_MOCK_SUBMISSION === 'true') {
    throw new Error('ZATCA mock modes are disabled in production')
  }
}

export function isMockOnboardingEnabled(): boolean {
  if (process.env.NODE_ENV === 'production') return false
  return process.env.ZATCA_MOCK_ONBOARDING === 'true'
}

export function isMockSubmissionEnabled(): boolean {
  if (process.env.NODE_ENV === 'production') return false
  return (
    process.env.ZATCA_MOCK_SUBMISSION === 'true'
    || process.env.ZATCA_MOCK_ONBOARDING === 'true'
  )
}
