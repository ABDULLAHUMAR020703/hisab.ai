import { requireAuth } from '@/lib/auth'
import { submitComplianceOnboarding } from '@/lib/zatca/onboarding/service'

/**
 * POST /api/zatca/onboarding/compliance
 * Body: { otp: string }
 */
export async function POST(request: Request) {
  try {
    const user = await requireAuth()
    const body = await request.json()
    const otp = body?.otp

    if (!otp || typeof otp !== 'string') {
      return Response.json({ error: 'OTP is required' }, { status: 400 })
    }

    const result = await submitComplianceOnboarding(otp, { userId: user.id, userName: user.name })
    return Response.json(result)
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return Response.json({ error: String(error) }, { status: 422 })
  }
}
