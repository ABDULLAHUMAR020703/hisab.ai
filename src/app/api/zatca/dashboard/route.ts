import { requireAuth } from '@/lib/auth'
import { getRecentAuditLogs } from '@/lib/zatca/audit'
import { getZatcaDashboardStats, getZatcaOperationalSummary, getZatcaRecentActivity } from '@/lib/zatca/monitoring'
import { getSandboxTestHistory } from '@/lib/zatca/testing/sandbox-runner'

export async function GET() {
  try {
    await requireAuth()

    const [stats, activity, auditLogs, sandboxTests, operations] = await Promise.all([
      getZatcaDashboardStats(),
      getZatcaRecentActivity(20),
      getRecentAuditLogs(15),
      getSandboxTestHistory(10),
      getZatcaOperationalSummary(),
    ])

    return Response.json({ stats, activity, auditLogs, sandboxTests, operations })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return Response.json({ error: String(error) }, { status: 500 })
  }
}
