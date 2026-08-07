import 'server-only'

export const QUICKBOOKS_CERTIFICATION_FEATURE_FLAG = 'ENABLE_QUICKBOOKS_CERTIFICATION'

/**
 * TODO(release): QuickBooks Accounting Certification is temporarily disabled
 * for the production release. Re-enable it after accounting reconciliation is
 * fully verified by setting ENABLE_QUICKBOOKS_CERTIFICATION=true.
 */
export function isQuickBooksCertificationEnabled(value = process.env.ENABLE_QUICKBOOKS_CERTIFICATION): boolean {
  return value?.trim().toLowerCase() === 'true'
}

export function quickBooksCertificationDisabledResponse(): Response {
  return Response.json({
    error: {
      code: 'FEATURE_TEMPORARILY_DISABLED',
      message: 'Feature Temporarily Disabled',
    },
  }, { status: 404, headers: { 'Cache-Control': 'no-store' } })
}

export function assertQuickBooksCertificationEnabled(): void {
  if (!isQuickBooksCertificationEnabled()) {
    throw new Error('QuickBooks Accounting Certification is temporarily disabled.')
  }
}
