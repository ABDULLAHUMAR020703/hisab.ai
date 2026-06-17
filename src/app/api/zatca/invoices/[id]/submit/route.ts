import { requireAuth } from '@/lib/auth'
import { ZatcaError } from '@/lib/zatca/errors'
import { submitInvoice } from '@/lib/zatca/submission'

/**
 * POST /api/zatca/invoices/:id/submit
 * Full ZATCA submission workflow for an invoice.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireAuth()
    const { id } = await params
    const result = await submitInvoice(id, {
      userId: user.id,
      userName: user.name,
    })
    return Response.json(result)
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof ZatcaError) {
      return Response.json({
        error: error.message,
        code: error.code,
        diagnostic: error.diagnostic,
      }, { status: 422 })
    }
    return Response.json({ error: String(error) }, { status: 422 })
  }
}
