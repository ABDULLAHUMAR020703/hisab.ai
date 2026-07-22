import { requireRole, authzErrorResponse } from '@/lib/authz'
import {
  getProductionLiveState,
  listReadinessHistory,
  runGoLiveAnalyze,
} from '@/lib/go-live'
import { getLatestHealthScore, listHealthHistory } from '@/lib/data-health'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET() {
  try {
    const user = await requireRole(['OWNER', 'ADMIN'])
    const analysis = await runGoLiveAnalyze(user.companyId)
    const productionLive = await getProductionLiveState(user.companyId)
    const readinessHistory = await listReadinessHistory(user.companyId, 14)
    const healthLatest = await getLatestHealthScore(user.companyId)
    const healthHistory = await listHealthHistory(user.companyId, 14)

    const db = createAdminClient()
    const { data: company } = await db
      .from('companies')
      .select('opening_balance_mode, opening_balance_acknowledged_at')
      .eq('id', user.companyId)
      .maybeSingle()

    return Response.json({
      readiness: {
        score: analysis.score,
        verdict: analysis.verdict,
        checklist: analysis.checklist,
        blocked: analysis.blocked,
        categoryScores: analysis.categoryScores,
        moduleCounts: analysis.moduleCounts,
        zatca: analysis.zatca,
        numbering: analysis.numbering,
        openingBalanceMode: company?.opening_balance_mode ?? analysis.openingBalanceMode,
        openingBalanceAcknowledgedAt: company?.opening_balance_acknowledged_at ?? null,
        history: readinessHistory,
      },
      dataHealth: {
        score: healthLatest?.score ?? null,
        severityCounts: healthLatest?.severity_counts ?? null,
        lastScannedAt: healthLatest?.recorded_at ?? null,
        history: healthHistory,
      },
      productionLive,
      wizardVersion: analysis.wizardVersion,
      detectionEngineVersion: analysis.detectionEngineVersion,
    })
  } catch (error) {
    return authzErrorResponse(error)
  }
}
