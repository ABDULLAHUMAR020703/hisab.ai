import { requireRole, authzErrorResponse } from '@/lib/authz'
import { logAudit } from '@/lib/audit/log'
import {
  buildPreviewPlan,
  getGoLiveSession,
  updateGoLiveSession,
  type GoLiveSelection,
} from '@/lib/go-live'

export async function POST(request: Request) {
  try {
    const user = await requireRole(['OWNER', 'ADMIN'])
    const body = await request.json()
    const sessionId = String(body.sessionId ?? '')
    const selection = body.selection as GoLiveSelection

    const session = await getGoLiveSession(sessionId, user.companyId)
    if (!session?.analysis) {
      return Response.json({ error: 'Analyze the company first' }, { status: 400 })
    }

    const preview = buildPreviewPlan(session.analysis, {
      softDeleteInvoiceIds: selection?.softDeleteInvoiceIds ?? [],
      archiveCustomerIds: selection?.archiveCustomerIds ?? [],
      archiveVendorIds: selection?.archiveVendorIds ?? [],
      archiveProductIds: selection?.archiveProductIds ?? [],
      archiveCostCenterIds: selection?.archiveCostCenterIds ?? [],
      numbering: selection?.numbering ?? null,
      acknowledgeDashboardLive: Boolean(selection?.acknowledgeDashboardLive),
    })

    const updated = await updateGoLiveSession(
      sessionId,
      {
        status: 'PREVIEWED',
        selection_json: selection,
        preview_json: preview,
      },
      user.companyId,
    )

    await logAudit({
      action: 'GO_LIVE_PREVIEWED',
      entityType: 'company',
      entityId: user.companyId,
      userId: user.id,
      companyId: user.companyId,
      details: { sessionId, canExecute: preview.canExecute, blockers: preview.blockers },
    })

    return Response.json({ session: updated, preview })
  } catch (error) {
    return authzErrorResponse(error)
  }
}
