import { requireAuth } from '@/lib/auth'
import { generateAndStoreCsr } from '@/lib/zatca/onboarding/service'

/**
 * POST /api/zatca/onboarding/csr
 * Generates a ZATCA CSR and stores encrypted credentials.
 */
export async function POST() {
  try {
    const user = await requireAuth()
    const result = await generateAndStoreCsr({ userId: user.id, userName: user.name })
    return Response.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return Response.json({ error: String(error) }, { status: 422 })
  }
}
