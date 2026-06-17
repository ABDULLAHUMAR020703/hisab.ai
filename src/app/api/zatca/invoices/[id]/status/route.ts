import { requireAuth } from '@/lib/auth'
import { getInvoiceZatcaStatus } from '@/lib/zatca/submission/status'

/**
 * GET /api/zatca/invoices/:id/status
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAuth()
    const { id } = await params
    const status = await getInvoiceZatcaStatus(id)
    if (!status) {
      return Response.json({ error: 'Invoice not found' }, { status: 404 })
    }
    return Response.json(status)
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return Response.json({ error: String(error) }, { status: 500 })
  }
}
