import { requireRole, authzErrorResponse } from '@/lib/authz'
import { logAudit } from '@/lib/audit/log'
import { runDataHealthScan } from '@/lib/data-health'

export async function POST() {
  try {
    const user = await requireRole(['OWNER', 'ADMIN'])
    const { scanId, report } = await runDataHealthScan({
      companyId: user.companyId,
      createdBy: user.id,
    })

    await logAudit({
      action: 'DATA_HEALTH_SCAN_COMPLETED',
      entityType: 'company',
      entityId: user.companyId,
      userId: user.id,
      companyId: user.companyId,
      details: {
        scanId,
        score: report.overallScore,
        summary: report.summary,
        engineVersion: report.engineVersion,
      },
    })

    return Response.json({ scanId, report })
  } catch (error) {
    return authzErrorResponse(error)
  }
}
