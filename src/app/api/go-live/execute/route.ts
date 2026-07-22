import { requireRole, authzErrorResponse } from '@/lib/authz'
import { CONFIRM_PHRASE, executeGoLive, getGoLiveSession, type GoLiveSelection } from '@/lib/go-live'
import { buildPreviewPlan } from '@/lib/go-live/preview/plan'

export async function POST(request: Request) {
  try {
    const user = await requireRole(['OWNER'])
    const body = await request.json()
    const sessionId = String(body.sessionId ?? '')
    const confirmPhrase = String(body.confirmPhrase ?? '')
    const idempotencyKey = String(body.idempotencyKey ?? crypto.randomUUID())

    if (confirmPhrase !== CONFIRM_PHRASE) {
      return Response.json(
        { error: `Type ${CONFIRM_PHRASE} to confirm` },
        { status: 400 },
      )
    }

    const session = await getGoLiveSession(sessionId, user.companyId)
    if (!session?.analysis) {
      return Response.json({ error: 'Analyze the company first' }, { status: 400 })
    }

    const selection = (body.selection ?? session.selection ?? {
      softDeleteInvoiceIds: [],
      archiveCustomerIds: [],
      archiveVendorIds: [],
      archiveProductIds: [],
      archiveCostCenterIds: [],
      numbering: null,
      acknowledgeDashboardLive: true,
    }) as GoLiveSelection

    const preview =
      session.preview ?? buildPreviewPlan(session.analysis, selection)

    if (!preview.canExecute) {
      return Response.json(
        { error: 'Execution blocked', blockers: preview.blockers },
        { status: 409 },
      )
    }

    const result = await executeGoLive({
      companyId: user.companyId,
      sessionId,
      executedBy: user.id,
      idempotencyKey,
      selection,
      preview,
      analysis: session.analysis,
    })

    return Response.json(result)
  } catch (error) {
    const status = (error as { status?: number })?.status
    if (status === 409 || status === 404) {
      return Response.json(
        { error: error instanceof Error ? error.message : String(error) },
        { status },
      )
    }
    return authzErrorResponse(error)
  }
}
