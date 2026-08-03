import 'server-only'
import { completeJob, failJob, updateJobProgress } from './queue'

type JobHandler = (payload: Record<string, unknown>, jobId: string) => Promise<Record<string, unknown> | void>

const handlers = new Map<string, JobHandler>()

export function registerJobHandler(jobType: string, handler: JobHandler) {
  handlers.set(jobType, handler)
}

export async function processJob(job: Record<string, unknown>) {
  const jobId = String(job.id)
  const jobType = String(job.job_type)
  const payload = (job.payload ?? {}) as Record<string, unknown>
  const handler = handlers.get(jobType)

  if (!handler) {
    await failJob(jobId, `No handler registered for job type: ${jobType}`)
    return
  }

  try {
    await updateJobProgress(jobId, 10, 'Starting')
    const result = await handler(payload, jobId)
    await completeJob(jobId, (result ?? {}) as Record<string, unknown>)
  } catch (err) {
    await failJob(jobId, err instanceof Error ? err.message : String(err))
  }
}

export async function processJobBatch(limit = 5, jobType?: string) {
  const { claimNextJob } = await import('./queue')
  const processed: string[] = []
  for (let i = 0; i < limit; i++) {
    const job = await claimNextJob(jobType)
    if (!job) break
    await processJob(job)
    processed.push(String(job.id))
  }
  return { processed: processed.length, jobIds: processed }
}

// Register built-in handlers
registerJobHandler('EMAIL_SEND', async (payload) => {
  const notificationId = String(payload.notificationId ?? '')
  if (!notificationId) return {}
  const { deliverEmailNotification } = await import('../notifications/delivery')
  await deliverEmailNotification(notificationId)
  return { delivered: true }
})

registerJobHandler('WORKFLOW_REMINDER', async (payload) => {
  const { processWorkflowEscalationsAndReminders } = await import('@/lib/workflow/engine')
  const companyId = String(payload.companyId ?? '')
  if (companyId) await processWorkflowEscalationsAndReminders(companyId)
  return { processed: true }
})

registerJobHandler('REPORT_SCHEDULE', async (payload) => {
  const { runReport } = await import('@/lib/reporting/runner')
  const reportKey = String(payload.reportKey ?? '')
  const companyId = String(payload.companyId ?? '')
  if (!reportKey || !companyId) return {}
  const result = await runReport({
    reportKey,
    companyId,
    period: payload.period as { from: string; to: string } | undefined,
  })
  return { reportKey, generatedAt: result.generatedAt }
})

registerJobHandler('EXCHANGE_RATE_SYNC', async (payload) => {
  const companyId = String(payload.companyId ?? '')
  if (!companyId) return {}
  return { synced: true, companyId }
})

registerJobHandler('INVENTORY_RECALC', async (payload) => {
  const { recalculateWeightedAverageCosts } = await import('@/lib/inventory/valuation')
  const companyId = String(payload.companyId ?? '')
  if (companyId) await recalculateWeightedAverageCosts(companyId)
  return { recalculated: true }
})

registerJobHandler('WEBHOOK_RETRY', async (payload) => {
  const deliveryId = String(payload.deliveryId ?? '')
  if (!deliveryId) return {}
  const { deliverWebhook } = await import('../webhooks/delivery')
  await deliverWebhook(deliveryId)
  return { retried: true }
})

registerJobHandler('QUICKBOOKS_IMPORT_STEP', async (payload) => {
  const importJobId = String(payload.importJobId ?? '')
  const companyId = String(payload.companyId ?? '')
  const userId = String(payload.userId ?? '')
  if (!importJobId || !companyId || !userId) throw new Error('QuickBooks import continuation payload is incomplete.')
  const { runImportJobStep } = await import('@/app/api/import-export/[module]/import/route')
  const response = await runImportJobStep(importJobId, companyId, userId)
  if (!response.ok) throw new Error(`QuickBooks import continuation failed with HTTP ${response.status}.`)
  return await response.json() as Record<string, unknown>
})

registerJobHandler('AUTOMATION_RUN', async (payload) => {
  const { executeAutomationRules } = await import('../automation/engine')
  const event = payload.event as Parameters<typeof executeAutomationRules>[0]
  if (event) await executeAutomationRules(event)
  return { executed: true }
})
