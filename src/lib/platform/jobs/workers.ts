import 'server-only'
import { completeJob, failJob, heartbeatJob, updateJobProgress, HEARTBEAT_INTERVAL_MS } from './queue'
import { createJobOwnership, isOwnershipLostError, type JobOwnership } from './ownership'
import { logger } from '@/lib/ops/logger'

type JobHandler = (
  payload: Record<string, unknown>,
  jobId: string,
  ownership: JobOwnership,
) => Promise<Record<string, unknown> | void>

const handlers = new Map<string, JobHandler>()

export function registerJobHandler(jobType: string, handler: JobHandler) {
  handlers.set(jobType, handler)
}

export async function processJob(job: Record<string, unknown>) {
  const jobId = String(job.id)
  const jobType = String(job.job_type)
  const attempt = Number(job.attempts ?? 0)
  const payload = (job.payload ?? {}) as Record<string, unknown>
  const handler = handlers.get(jobType)
  const ownership = createJobOwnership(jobId, attempt)

  if (!handler) {
    await failJob(jobId, `No handler registered for job type: ${jobType}`, attempt)
    return
  }

  try {
    logger.info('quickbooks.worker.job.claimed', {
      platformJobId: jobId,
      jobType,
      attempt,
      importJobId: payload.importJobId == null ? undefined : String(payload.importJobId),
      companyId: payload.companyId == null ? undefined : String(payload.companyId),
    })
    await updateJobProgress(jobId, 10, 'Starting', attempt)
    await ownership.assertOwned()

    let heartbeatFailure: Error | null = null
    const heartbeat = async () => {
      try {
        const owned = await heartbeatJob(jobId, attempt)
        if (!owned) {
          ownership.markLost('heartbeat_rejected')
          heartbeatFailure = new Error(`Queue ownership lost for job ${jobId} attempt ${attempt}.`)
        }
      } catch (error) {
        ownership.markLost('heartbeat_error')
        heartbeatFailure = error instanceof Error ? error : new Error(String(error))
      }
    }
    // Refresh the lease immediately so long handlers cannot race a stale reclaim
    // before the first interval tick.
    await heartbeat()
    if (ownership.isLost()) throw heartbeatFailure ?? new Error(`Queue ownership lost for job ${jobId} attempt ${attempt}.`)

    const heartbeatTimer = setInterval(() => { void heartbeat() }, HEARTBEAT_INTERVAL_MS)
    try {
      const result = await handler(payload, jobId, ownership)
      if (ownership.isLost() || heartbeatFailure) {
        throw heartbeatFailure ?? new Error(`Queue ownership lost for job ${jobId} attempt ${attempt}.`)
      }
      await ownership.assertOwned()
      logger.info('quickbooks.worker.job.handler_completed', {
        platformJobId: jobId,
        jobType,
        attempt,
        importJobId: payload.importJobId == null ? undefined : String(payload.importJobId),
        companyId: payload.companyId == null ? undefined : String(payload.companyId),
      })
      await completeJob(jobId, (result ?? {}) as Record<string, unknown>, attempt)
    } finally {
      clearInterval(heartbeatTimer)
    }
  } catch (err) {
    if (isOwnershipLostError(err) || ownership.isLost()) {
      logger.warn('quickbooks.worker.job.abandoned_after_ownership_loss', {
        platformJobId: jobId,
        jobType,
        attempt,
        importJobId: payload.importJobId == null ? undefined : String(payload.importJobId),
        companyId: payload.companyId == null ? undefined : String(payload.companyId),
        error: err instanceof Error ? { message: err.message, name: err.name } : { message: String(err) },
      })
      return
    }
    logger.error('quickbooks.worker.job.failed', {
      platformJobId: jobId,
      jobType,
      attempt,
      importJobId: payload.importJobId == null ? undefined : String(payload.importJobId),
      companyId: payload.companyId == null ? undefined : String(payload.companyId),
      error: err instanceof Error ? { message: err.message, stack: err.stack } : { message: String(err) },
    })
    await failJob(jobId, err instanceof Error ? err.message : String(err), attempt)
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

registerJobHandler('QUICKBOOKS_IMPORT_STEP', async (payload, platformJobId, ownership) => {
  const importJobId = String(payload.importJobId ?? '')
  const companyId = String(payload.companyId ?? '')
  const userId = String(payload.userId ?? '')
  if (!importJobId || !companyId || !userId) throw new Error('QuickBooks import continuation payload is incomplete.')
  logger.info('quickbooks.worker.import_step.dispatch', { platformJobId, importJobId, companyId, userId, attempt: ownership.attempt })
  await ownership.assertOwned()
  const [{ runImportJobStep }, { withCompanyContext }] = await Promise.all([
    import('@/app/api/import-export/[module]/import/route'),
    import('@/lib/tenant'),
  ])
  // Tenant is taken from the queue payload, never from Next.js cookies/headers.
  return withCompanyContext(companyId, async () => {
    try {
      const response = await runImportJobStep(importJobId, companyId, userId, ownership)
      const payload = await response.json() as Record<string, unknown>
      if (!response.ok) {
        const detail = typeof payload.error === 'string' && payload.error.trim()
          ? payload.error.trim()
          : `QuickBooks import continuation failed with HTTP ${response.status}.`
        throw new Error(detail)
      }
      await ownership.assertOwned()
      return payload
    } finally {
      // This row is still RUNNING until the handler returns, so it is excluded:
      // the session must be judged on the work that outlives this step.
      const { advanceQuickBooksMigrationAfterImportJob, reconcileMigrationSessionForImportJob } = await import('@/lib/import-export/wizard/migration-session.service')
      await reconcileMigrationSessionForImportJob(importJobId, companyId, { ignoreQueueJobIds: [platformJobId] })
      await advanceQuickBooksMigrationAfterImportJob(importJobId, companyId, userId)
    }
  })
})

registerJobHandler('AUTOMATION_RUN', async (payload) => {
  const { executeAutomationRules } = await import('../automation/engine')
  const event = payload.event as Parameters<typeof executeAutomationRules>[0]
  if (event) await executeAutomationRules(event)
  return { executed: true }
})
