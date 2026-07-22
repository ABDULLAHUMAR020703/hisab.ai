import { requireRole, authzErrorResponse } from '@/lib/authz'
import { logAudit } from '@/lib/audit/log'
import {
  appendReadinessHistory,
  createGoLiveSession,
  runGoLiveAnalyze,
  updateGoLiveSession,
} from '@/lib/go-live'

export async function POST() {
  try {
    const user = await requireRole(['OWNER', 'ADMIN'])
    const session = await createGoLiveSession(user.id, user.companyId)

    await updateGoLiveSession(
      session.id,
      {
        status: 'RUNNING',
        progress_json: { phase: 'scanning', percent: 20 },
      },
      user.companyId,
    )

    const analysis = await runGoLiveAnalyze(user.companyId)

    const updated = await updateGoLiveSession(
      session.id,
      {
        status: 'ANALYZED',
        analysis_json: analysis,
        progress_json: { phase: 'done', percent: 100 },
      },
      user.companyId,
    )

    await appendReadinessHistory({
      companyId: user.companyId,
      sessionId: session.id,
      score: analysis.score,
      verdict: analysis.verdict,
      blockedCount: analysis.blocked.length,
      checklist: analysis.checklist,
    })

    await logAudit({
      action: 'GO_LIVE_ANALYZED',
      entityType: 'company',
      entityId: user.companyId,
      userId: user.id,
      companyId: user.companyId,
      details: {
        sessionId: session.id,
        score: analysis.score,
        verdict: analysis.verdict,
        detectionEngineVersion: analysis.detectionEngineVersion,
        rulesExecuted: analysis.rulesExecuted,
      },
    })

    return Response.json({ session: updated, analysis })
  } catch (error) {
    return authzErrorResponse(error)
  }
}
