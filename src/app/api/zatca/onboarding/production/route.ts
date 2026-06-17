import { requireAuth } from '@/lib/auth'
import { requestAndStoreProductionCsid } from '@/lib/zatca/onboarding/service'

/**
 * POST /api/zatca/onboarding/production
 * Requests and stores Production CSID after compliance onboarding.
 */
export async function POST() {
  try {
    const user = await requireAuth()
    const result = await requestAndStoreProductionCsid({ userId: user.id, userName: user.name })
    return Response.json(result)
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return Response.json({ error: String(error) }, { status: 422 })
  }
}
