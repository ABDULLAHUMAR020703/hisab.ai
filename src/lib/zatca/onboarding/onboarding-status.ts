import type { ZatcaOnboardingStatus } from '@/lib/db/prisma-types'

const PROTECTED_ONBOARDING_STATUSES = new Set<ZatcaOnboardingStatus>([
  'COMPLIANCE_ISSUED',
  'COMPLIANCE_VALIDATED',
  'PRODUCTION_ISSUED',
  'PRODUCTION_READY',
])

/**
 * Keeps a valid onboarding state when a non-fatal step (e.g. Production CSID retry) fails.
 */
export function resolveOnboardingStatusAfterProductionFailure(
  currentStatus: ZatcaOnboardingStatus,
  hasComplianceCsid: boolean,
): ZatcaOnboardingStatus {
  if (PROTECTED_ONBOARDING_STATUSES.has(currentStatus)) {
    return currentStatus
  }
  return hasComplianceCsid ? 'COMPLIANCE_ISSUED' : 'FAILED'
}
