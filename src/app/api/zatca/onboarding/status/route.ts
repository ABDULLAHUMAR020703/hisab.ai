import { requireAuth } from '@/lib/auth'
import { getSettingsRepository } from '@/lib/db/provider'
import { getOnboardingStatus } from '@/lib/zatca/onboarding/service'

/**
 * GET /api/zatca/onboarding/status
 * Returns onboarding status for the active ZATCA environment (no secrets).
 */
export async function GET() {
  try {
    await requireAuth()

    const settings = await getSettingsRepository().findFirst()
    const environment = settings?.zatcaEnvironment ?? 'SANDBOX'
    const status = await getOnboardingStatus(environment)

    return Response.json({
      zatcaEnabled: settings?.zatcaEnabled ?? false,
      connectedAt: settings?.zatcaConnectedAt?.toISOString() ?? null,
      companyName: settings?.companyName ?? null,
      taxId: settings?.taxId ?? null,
      commercialRegistration: settings?.commercialRegistration ?? null,
      ...status,
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return Response.json({ error: String(error) }, { status: 500 })
  }
}
