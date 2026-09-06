import 'server-only'
import { completeJob, failJob, heartbeatJob, updateJobProgress, HEARTBEAT_INTERVAL_MS } from './queue'
import { createJobOwnership, isOwnershipLostError, type JobOwnership } from './ownership'
import { logger } from '@/lib/ops/logger'
import { isTerminalImportJobStatus } from '@/lib/import-export/wizard/migration-session'

type JobHandler = (
  payload: Record<string, unknown>,
  jobId: string,
  ownership: JobOwnership,
) => Promise<Record<string, unknown> | void>

const handlers = new Map<string, JobHandler>()

export function registerJobHandler(jobType: string, handler: JobHandler) {
  handlers.set(jobType, handler)
}

type PostCompleteHook = (
  payload: Record<string, unknown>,
  jobId: string,
  result: Record<string, unknown> | void,
) => Promise<void>

const postCompleteHooks = new Map<string, PostCompleteHook>()

/**
 * Registers a best-effort hook that runs once a job's queue row is durably
 * COMPLETED (after `completeJob`, never before). This is the seam that lets a
 * job type schedule follow-up work without racing the unique "one active step"
 * guard, which only rejects inserts while the current row is still
 * PENDING/RUNNING. A hook failure is logged and swallowed — it must never fail
 * the worker loop or the job that just completed, and `recoverOrphanedContinuations`
 * remains the crash-safe fallback if a hook throws or never runs.
 */
export function registerPostCompleteHook(jobType: string, hook: PostCompleteHook) {
  postCompleteHooks.set(jobType, hook)
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
      const postComplete = postCompleteHooks.get(jobType)
      if (postComplete) {
        try {
          await postComplete(payload, jobId, result)
        } catch (hookError) {
          // Never fail a job that already completed successfully over a
          // follow-up scheduling problem. recoverOrphanedContinuations covers it.
          logger.error('quickbooks.worker.post_complete_hook_failed', {
            platformJobId: jobId,
            jobType,
            error: hookError instanceof Error ? { message: hookError.message, name: hookError.name } : { message: String(hookError) },
          })
        }
      }
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

export async function processJobBatch(limit = 5, jobType?: string | string[]) {
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

/**
 * The platform queue row can complete while the import job is still processing
 * (multi-page continuation). Session advancement must observe a persisted
 * terminal import_jobs.status, never the handler return alone.
 */
async function coordinateQuickBooksMigrationAfterStep(input: {
  importJobId: string
  companyId: string
  userId: string
  platformJobId: string
}): Promise<void> {
  const { getImportJob } = await import('@/lib/import-export/jobs/import-job.service')
  const job = await getImportJob(input.importJobId, input.companyId)
  if (!job || !isTerminalImportJobStatus(job.status)) {
    logger.info('quickbooks.migration_session.advance_deferred', {
      reason: 'import_job_not_terminal',
      importJobId: input.importJobId,
      companyId: input.companyId,
      platformJobId: input.platformJobId,
      status: job?.status ?? null,
    })
    return
  }
  logger.info('quickbooks.import_job.terminal_status_persisted', {
    importJobId: job.id,
    companyId: input.companyId,
    status: job.status,
    processedRows: job.processedRows,
    totalRows: job.totalRows,
  })
  const { advanceQuickBooksMigrationAfterImportJob, reconcileMigrationSessionForImportJob } = await import('@/lib/import-export/wizard/migration-session.service')
  await reconcileMigrationSessionForImportJob(input.importJobId, input.companyId, { ignoreQueueJobIds: [input.platformJobId] })
  await advanceQuickBooksMigrationAfterImportJob(input.importJobId, input.companyId, input.userId)
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
      // Read the persisted import job after the step returns. Continuation
      // pages stay `processing` and must not schedule the next module.
      await coordinateQuickBooksMigrationAfterStep({
        importJobId,
        companyId,
        userId,
        platformJobId,
      })
    }
  })
})

// Runs only after the step's own queue row is COMPLETED, so the unique
// "one active QUICKBOOKS_IMPORT_STEP per import job" index no longer blocks the
// insert the way it does when a page tries to enqueue its own successor while
// still RUNNING (see enqueueQuickBooksContinuationOnce in the import route).
// A step reports `status: 'processing'` only when the page it just finished has
// more pages behind it; any other status (completed/failed/cancelled/paused) is
// terminal for this import job and gets no continuation.
registerPostCompleteHook('QUICKBOOKS_IMPORT_STEP', async (payload, _platformJobId, result) => {
  const status = result && typeof result === 'object' ? String((result as Record<string, unknown>).status ?? '') : ''
  if (status !== 'processing') return
  const importJobId = String(payload.importJobId ?? '')
  const companyId = String(payload.companyId ?? '')
  const moduleKey = String(payload.moduleKey ?? '')
  const userId = String(payload.userId ?? '')
  if (!importJobId || !companyId || !moduleKey || !userId) return
  const { ensureContinuationForImportJob } = await import('@/lib/platform/continuation-scheduler')
  const outcome = await ensureContinuationForImportJob({ importJobId, companyId, moduleKey, userId })
  logger.info('quickbooks.worker.continuation.scheduled_after_complete', {
    importJobId,
    companyId,
    createdPlatformJobId: outcome.created ? String(outcome.created.id ?? '') : null,
    existingPlatformJobId: outcome.existing?.id ?? null,
    existingStatus: outcome.existing?.status ?? null,
  })
})

registerJobHandler('QUICKBOOKS_SNAPSHOT_STEP', async (payload, platformJobId, ownership) => {
  const snapshotId = String(payload.snapshotId ?? '')
  const companyId = String(payload.companyId ?? '')
  const userId = String(payload.userId ?? '')
  if (!snapshotId || !companyId || !userId) throw new Error('QuickBooks snapshot step payload is incomplete.')
  logger.info('quickbooks.worker.snapshot_step.dispatch', { platformJobId, snapshotId, companyId, attempt: ownership.attempt })
  await ownership.assertOwned()
  const { runSnapshotStep } = await import('@/lib/import-export/quickbooks/snapshot/snapshot-step')
  const outcome = await runSnapshotStep(snapshotId, companyId, userId, ownership)
  await ownership.assertOwned()
  return outcome as unknown as Record<string, unknown>
})

// Same durable-continuation model as QUICKBOOKS_IMPORT_STEP: the next extraction
// step is scheduled only after this step's queue row is COMPLETED, so the
// standard "one active step per snapshot" (PENDING+RUNNING) index never blocks
// the insert. `done: false` means the orchestrator has more resources to extract
// or a final validation pass to run; a hook failure is swallowed and the
// operator's retry endpoint (POST /quickbooks-snapshots/:id/retry) is the
// crash-safe fallback.
registerPostCompleteHook('QUICKBOOKS_SNAPSHOT_STEP', async (payload, _platformJobId, result) => {
  const done = result && typeof result === 'object' ? Boolean((result as Record<string, unknown>).done) : true
  if (done) return
  const snapshotId = String(payload.snapshotId ?? '')
  const companyId = String(payload.companyId ?? '')
  const userId = String(payload.userId ?? '')
  if (!snapshotId || !companyId || !userId) return
  const { ensureSnapshotContinuation } = await import('@/lib/platform/continuation-scheduler')
  const outcome = await ensureSnapshotContinuation({ snapshotId, companyId, userId })
  logger.info('quickbooks.worker.snapshot.continuation.scheduled_after_complete', {
    snapshotId,
    companyId,
    createdPlatformJobId: outcome.created ? String(outcome.created.id ?? '') : null,
    existingPlatformJobId: outcome.existing?.id ?? null,
    existingStatus: outcome.existing?.status ?? null,
  })
})

registerJobHandler('AUTOMATION_RUN', async (payload) => {
  const { executeAutomationRules } = await import('../automation/engine')
  const event = payload.event as Parameters<typeof executeAutomationRules>[0]
  if (event) await executeAutomationRules(event)
  return { executed: true }
})
