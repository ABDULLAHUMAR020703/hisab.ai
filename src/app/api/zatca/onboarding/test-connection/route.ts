import { requireAuth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { testZatcaConnection } from '@/lib/zatca/onboarding/onboard'
import type { ZatcaEnvironment } from '@prisma/client'

/**
 * POST /api/zatca/onboarding/test-connection
 * Body: { environment?: 'SANDBOX' | 'PRODUCTION' }
 */
export async function POST(request: Request) {
  try {
    await requireAuth()
    const body = await request.json().catch(() => ({}))
    const environment = body?.environment as ZatcaEnvironment | undefined

    const settings = await prisma.companySettings.findFirst()
    const result = await testZatcaConnection(environment ?? settings?.zatcaEnvironment)

    return Response.json({
      ok: result.ok,
      message: result.message,
      hasPrivateKey: result.hasPrivateKey,
      hasCertificate: result.hasCertificate,
      hasSecret: result.hasSecret,
      environment: environment ?? settings?.zatcaEnvironment ?? 'SANDBOX',
    }, { status: result.ok ? 200 : 422 })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return Response.json({ error: String(error) }, { status: 500 })
  }
}
