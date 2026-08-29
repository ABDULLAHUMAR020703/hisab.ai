import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCompanyId } from '@/lib/tenant'
import { Provider } from '@/integrations/accounting/contracts/types'
import { createAccountingIntegrationRuntime } from '@/integrations/accounting/services/container'
import {
  cancelImportJob,
  createImportJob,
  getImportJobsByIds,
  getMigrationImportJob,
  incrementImportJobRetry,
  setImportJobStatus,
} from '@/lib/import-export/jobs/import-job.service'
import { enqueueJob } from '@/lib/platform/jobs/queue'
import { FrameworkBadRequestError, FrameworkNotFoundError } from '@/lib/import-export/errors'
import { planMigrationStartBootstrap } from './migration-session-bootstrap'
import {
  buildSessionConfig,
  importJobIdsFromConfig,
  isActiveMigrationSession,
  isImportJobOwnedByMigrationSession,
  isQuickBooksMigrationConfig,
  isTerminalImportJobStatus,
  isWorkerOwnedQuickBooksMigration,
  jobRecordToProgressSnapshot,
  resourceKeyForMigrationImportJob,
  restoreLifecycleFromSession,
  shouldAdvanceToNextMigrationModule,
  summarizeMigrationSession,
  type HydratedMigrationSession,
  type MigrationHistorySummary,
  type MigrationSessionRecord,
  type MigrationSessionState,
  type MigrationSessionStatus,
  type MigrationSessionStep,
  type QuickBooksMigrationSessionConfig,
} from './migration-session'
import {
  canCancelMigrationSession,
  MIGRATION_CANCEL_CONFIRMATION,
  planGracefulMigrationCancel,
  planResumeAfterCancellation,
} from './migration-cancel'
import { applyJobCreated, type ModuleLifecycleState, type SelectableResource } from './module-lifecycle'
import type { DuplicateStrategy } from '../types'
import {
  detectMigrationQueueHealth,
  type MigrationQueueHealthThresholds,
  type PersistedQueueJobSnapshot,
} from './migration-queue-health'
import {
  projectMigrationPollPayload,
  type MigrationActivityCursors,
  type MigrationPollEnvelope,
} from './migration-poll-payload'
import {
  collectMigrationSessionActivity,
  DEFAULT_MIGRATION_SESSION_STALE_MS,
  resolveMigrationSessionReconciliation,
} from './migration-session-reconcile'
import { shouldIncludeQueueHealthOnHydrate } from './migration-restore-timing'
import { logger } from '@/lib/ops/logger'

function configuredThreshold(value: string | undefined, fallback: number, minimum: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(minimum, parsed) : fallback
}

async function backfillMigrationImportJobOwnership(input: {
  sessionId: string
  companyId: string
  importJobId: string
  config: QuickBooksMigrationSessionConfig
}): Promise<void> {
  const resourceKey = resourceKeyForMigrationImportJob(input.config, input.importJobId)
  if (!resourceKey) return

  const client = createAdminClient()
  const { data: job, error } = await client
    .from('import_jobs')
    .select('id,migration_session_id,migration_resource_key')
    .eq('id', input.importJobId)
    .eq('company_id', input.companyId)
    .maybeSingle()
  if (error) throw error
  if (!job || job.migration_session_id === input.sessionId) return
  if (job.migration_session_id) return

  const patch: Record<string, unknown> = { migration_session_id: input.sessionId }
  if (!job.migration_resource_key) patch.migration_resource_key = resourceKey
  const { error: updateError } = await client
    .from('import_jobs')
    .update(patch)
    .eq('id', input.importJobId)
    .eq('company_id', input.companyId)
    .is('migration_session_id', null)
  if (updateError) throw updateError

  logger.info('quickbooks.migration_session.ownership_backfilled', {
    sessionId: input.sessionId,
    companyId: input.companyId,
    importJobId: input.importJobId,
    resourceKey,
  })
}

const QUEUE_HEALTH_THRESHOLDS: MigrationQueueHealthThresholds = {
  queueStallThresholdMs: configuredThreshold(
    process.env.MIGRATION_QUEUE_STALL_MS,
    2 * 60_000,
    10_000,
  ),
  heartbeatTimeoutMs: configuredThreshold(
    process.env.MIGRATION_WORKER_HEARTBEAT_TIMEOUT_MS ?? process.env.JOB_QUEUE_STALE_MS,
    5 * 60_000,
    30_000,
  ),
}

function mapSessionRow(row: Record<string, unknown>): MigrationSessionRecord {
  const config = row.config
  if (!isQuickBooksMigrationConfig(config)) {
    throw new FrameworkBadRequestError('Migration session is not a QuickBooks migration session.')
  }
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    userId: row.user_id ? String(row.user_id) : null,
    step: String(row.step) as MigrationSessionStep,
    status: String(row.status) as MigrationSessionStatus,
    config,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

async function hydrateSession(
  session: MigrationSessionRecord,
  options: {
    includeQueueHealth?: boolean
    includeActivityEvents?: boolean
  } = {},
): Promise<HydratedMigrationSession> {
  const hydrateStarted = Date.now()
  const jobIds = importJobIdsFromConfig(session.config)
  const includeQueueHealth = options.includeQueueHealth
    ?? shouldIncludeQueueHealthOnHydrate(session.config.state)
  const includeActivityEvents = options.includeActivityEvents !== false

  const jobsStarted = Date.now()
  const [jobs, queueRows] = await Promise.all([
    getImportJobsByIds(jobIds, session.companyId, { includeActivityEvents }),
    includeQueueHealth
      ? getMigrationQueueJobs(jobIds, session.companyId)
      : Promise.resolve([]),
  ])
  const jobsMs = Date.now() - jobsStarted

  const jobsByKey: HydratedMigrationSession['jobs'] = {}
  const queueJobsByKey: NonNullable<HydratedMigrationSession['queueJobs']> = {}
  const queueHealthByKey: NonNullable<HydratedMigrationSession['queueHealth']> = {}

  for (const [resourceKey, jobId] of Object.entries(session.config.importJobIds)) {
    const job = jobs.find((item) => item.id === jobId)
    if (job) jobsByKey[resourceKey] = jobRecordToProgressSnapshot(job)
  }
  for (const card of session.config.modules) {
    if (!card.jobId || jobsByKey[card.key]) continue
    const job = jobs.find((item) => item.id === card.jobId)
    if (job) jobsByKey[card.key] = jobRecordToProgressSnapshot(job)
  }

  if (includeQueueHealth) {
    for (const [resourceKey, job] of Object.entries(jobsByKey)) {
      const queueJob = selectCurrentQueueJob(queueRows, job.id)
      if (queueJob) queueJobsByKey[resourceKey] = queueJob
      queueHealthByKey[resourceKey] = detectMigrationQueueHealth({
        importJob: job,
        queueJob,
        thresholds: QUEUE_HEALTH_THRESHOLDS,
      })
    }
  }

  logger.debug('migration.session.hydrate', {
    sessionId: session.id,
    companyId: session.companyId,
    jobCount: jobIds.length,
    includeQueueHealth,
    includeActivityEvents,
    jobsMs,
    durationMs: Date.now() - hydrateStarted,
  })

  return {
    ...session,
    jobs: jobsByKey,
    queueJobs: queueJobsByKey,
    queueHealth: queueHealthByKey,
    queueHealthThresholds: QUEUE_HEALTH_THRESHOLDS,
    lifecycle: restoreLifecycleFromSession(session.config, jobsByKey),
  }
}

async function getMigrationQueueJobs(
  importJobIds: string[],
  companyId: string,
): Promise<PersistedQueueJobSnapshot[]> {
  if (importJobIds.length === 0) return []
  const client = createAdminClient()
  const { data, error } = await client
    .from('job_queue')
    .select('id,payload,status,scheduled_at,started_at,completed_at,created_at,updated_at,attempts,max_attempts,last_error')
    .eq('company_id', companyId)
    .eq('job_type', 'QUICKBOOKS_IMPORT_STEP')
    .in('status', ['PENDING', 'RUNNING'])
    .in('payload->>importJobId', importJobIds)
    .order('updated_at', { ascending: false })

  if (error) throw error
  return (data ?? []).flatMap((row) => {
    const payload = row.payload && typeof row.payload === 'object'
      ? row.payload as Record<string, unknown>
      : {}
    const importJobId = typeof payload.importJobId === 'string' ? payload.importJobId : null
    if (!importJobId) return []
    return [{
      id: String(row.id),
      importJobId,
      status: String(row.status),
      scheduledAt: String(row.scheduled_at),
      startedAt: row.started_at ? String(row.started_at) : null,
      completedAt: row.completed_at ? String(row.completed_at) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      attempts: Number(row.attempts ?? 0),
      maxAttempts: Number(row.max_attempts ?? 0),
      lastError: row.last_error ? String(row.last_error) : null,
    }]
  })
}

function selectCurrentQueueJob(
  rows: PersistedQueueJobSnapshot[],
  importJobId: string,
): PersistedQueueJobSnapshot | null {
  const matching = rows.filter((row) => row.importJobId === importJobId)
  return matching.find((row) => row.status === 'RUNNING' || row.status === 'PENDING')
    ?? matching[0]
    ?? null
}

const SESSION_STALE_MS = configuredThreshold(
  process.env.MIGRATION_SESSION_STALE_MS,
  DEFAULT_MIGRATION_SESSION_STALE_MS,
  60_000,
)

/**
 * Closes a running session that no longer has any queue job or worker behind it.
 *
 * Session completion used to be decided only by the browser that started the
 * migration, so a closed tab left the row IN_PROGRESS forever. This runs the
 * same decision server-side against persisted state, and is safe to call from
 * any read path: it is a no-op unless the session is provably finished or
 * abandoned.
 */
export async function reconcileQuickBooksMigrationSession(
  session: HydratedMigrationSession,
  options: { ignoreQueueJobIds?: readonly string[] } = {},
): Promise<HydratedMigrationSession> {
  const activity = collectMigrationSessionActivity(session, options)
  const resolution = resolveMigrationSessionReconciliation(session, activity, {
    stalledAfterMs: SESSION_STALE_MS,
  })
  if (!resolution) return session

  logger.info('quickbooks.migration_session.reconciled', {
    sessionId: session.id,
    companyId: session.companyId,
    state: resolution.state,
    reason: resolution.reason,
    lastActivityAt: activity.lastActivityAt,
  })

  return updateQuickBooksMigrationSession({
    sessionId: session.id,
    companyIdOverride: session.companyId,
    lifecycle: session.lifecycle,
    step: resolution.step,
    state: resolution.state,
  })
}

/**
 * Worker-side entry point: after an import job reaches a terminal state, close
 * the owning session if nothing else is left to run. Never throws into the job
 * handler — a reconciliation failure must not fail a completed import.
 */
export async function reconcileMigrationSessionForImportJob(
  importJobId: string,
  companyId: string,
  options: { ignoreQueueJobIds?: readonly string[] } = {},
): Promise<void> {
  try {
    const client = createAdminClient()
    const { data, error } = await client
      .from('migration_wizard_sessions')
      .select('*')
      .eq('company_id', companyId)
      .eq('status', 'IN_PROGRESS')
      .order('updated_at', { ascending: false })
      .limit(40)
    if (error) throw error

    for (const row of data ?? []) {
      if (!isQuickBooksMigrationConfig(row.config)) continue
      if (!isWorkerOwnedQuickBooksMigration(row.config)) continue
      if (!importJobIdsFromConfig(row.config).includes(importJobId)) continue
      const { data: ownedJob, error: ownedJobError } = await client
        .from('import_jobs')
        .select('id,migration_session_id')
        .eq('id', importJobId)
        .eq('company_id', companyId)
        .maybeSingle()
      if (ownedJobError) throw ownedJobError
      if (!isImportJobOwnedByMigrationSession(row.id, row.config, importJobId, ownedJob)) continue
      await backfillMigrationImportJobOwnership({
        sessionId: row.id,
        companyId,
        importJobId,
        config: row.config,
      })
      await reconcileQuickBooksMigrationSession(await hydrateSession(mapSessionRow(row)), options)
      return
    }
  } catch (error) {
    logger.error('quickbooks.migration_session.reconcile_failed', {
      importJobId,
      companyId,
      error: error instanceof Error
        ? { name: error.name, message: error.message }
        : { message: String(error) },
    })
  }
}

/** Returns the company's active QuickBooks migration session, if any. Never creates one. */
export async function findActiveQuickBooksMigrationSession(companyIdOverride?: string): Promise<HydratedMigrationSession | null> {
  const client = createAdminClient()
  const companyId = companyIdOverride ?? await resolveCompanyId()
  const { data, error } = await client
    .from('migration_wizard_sessions')
    .select('*')
    .eq('company_id', companyId)
    .eq('status', 'IN_PROGRESS')
    .order('updated_at', { ascending: false })
    .limit(20)

  if (error) throw error
  const match = (data ?? []).find((row) => {
    try {
      return isActiveMigrationSession(mapSessionRow(row))
    } catch {
      return false
    }
  })
  if (!match) return null
  const hydrated = await reconcileQuickBooksMigrationSession(await hydrateSession(mapSessionRow(match)))
  return isActiveMigrationSession(hydrated) ? hydrated : null
}

/** Returns the latest QuickBooks session, including completed or failed sessions. */
export async function findLatestQuickBooksMigrationSession(companyIdOverride?: string): Promise<HydratedMigrationSession | null> {
  const client = createAdminClient()
  const companyId = companyIdOverride ?? await resolveCompanyId()
  const { data, error } = await client
    .from('migration_wizard_sessions')
    .select('*')
    .eq('company_id', companyId)
    .order('updated_at', { ascending: false })
    .limit(20)

  if (error) throw error
  const match = (data ?? []).find((row) => isQuickBooksMigrationConfig(row.config))
  return match ? hydrateSession(mapSessionRow(match)) : null
}

export async function listQuickBooksMigrationSessions(input?: {
  companyIdOverride?: string
  page?: number
  limit?: number
  status?: MigrationSessionState | ''
}): Promise<{ items: MigrationHistorySummary[]; total: number; page: number; limit: number }> {
  const client = createAdminClient()
  const companyId = input?.companyIdOverride ?? await resolveCompanyId()
  const page = Math.max(1, input?.page ?? 1)
  const limit = Math.min(50, Math.max(1, input?.limit ?? 25))
  const statusFilter = input?.status ?? ''

  const { data, error } = await client
    .from('migration_wizard_sessions')
    .select('*')
    .eq('company_id', companyId)
    .order('updated_at', { ascending: false })
    .limit(200)

  if (error) throw error

  const quickbooksRows = (data ?? []).filter((row) => isQuickBooksMigrationConfig(row.config))
  const filtered = statusFilter
    ? quickbooksRows.filter((row) => {
      try {
        return mapSessionRow(row).config.state === statusFilter
      } catch {
        return false
      }
    })
    : quickbooksRows

  const total = filtered.length
  const slice = filtered.slice((page - 1) * limit, page * limit)
  const items: MigrationHistorySummary[] = []
  for (const row of slice) {
    const hydrated = await hydrateSession(mapSessionRow(row), { includeQueueHealth: false })
    items.push(summarizeMigrationSession(hydrated))
  }
  return { items, total, page, limit }
}

export async function getQuickBooksMigrationSession(
  sessionId: string,
  companyIdOverride?: string,
  options: { includeQueueHealth?: boolean; includeActivityEvents?: boolean } = {},
): Promise<HydratedMigrationSession | null> {
  const client = createAdminClient()
  const companyId = companyIdOverride ?? await resolveCompanyId()
  const { data, error } = await client
    .from('migration_wizard_sessions')
    .select('*')
    .eq('id', sessionId)
    .eq('company_id', companyId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  if (!isQuickBooksMigrationConfig(data.config)) return null
  return hydrateSession(mapSessionRow(data), options)
}

/** Compact poll projection for MigrationSessionProvider. Existing full APIs remain unchanged. */
export async function pollQuickBooksMigrationSession(input: {
  sessionId?: string | null
  includeLatest?: boolean
  includeStatic?: boolean
  includeActivityEvents?: boolean
  activityCursors?: MigrationActivityCursors
  previousLiveFingerprint?: string | null
}): Promise<{ session: HydratedMigrationSession | null; poll: MigrationPollEnvelope | null }> {
  const pollStarted = Date.now()
  const hydrateOptions = {
    includeActivityEvents: input.includeActivityEvents !== false,
  }
  const found = input.sessionId
    ? await getQuickBooksMigrationSession(input.sessionId, undefined, hydrateOptions)
    : input.includeLatest
      ? await findLatestQuickBooksMigrationSession()
      : await findActiveQuickBooksMigrationSession()
  if (!found) return { session: null, poll: null }
  const reconcileStarted = Date.now()
  const session = await reconcileQuickBooksMigrationSession(found)
  const reconcileMs = Date.now() - reconcileStarted
  const poll = projectMigrationPollPayload(session, {
    includeStatic: input.includeStatic ?? true,
    activityCursors: input.activityCursors,
    previousLiveFingerprint: input.previousLiveFingerprint,
  })
  logger.debug('migration.session.poll', {
    sessionId: session.id,
    companyId: session.companyId,
    includeStatic: input.includeStatic ?? true,
    includeActivityEvents: hydrateOptions.includeActivityEvents,
    reconcileMs,
    durationMs: Date.now() - pollStarted,
    pollKind: poll.kind,
  })
  return { session, poll }
}

export async function createQuickBooksMigrationSession(input: {
  userId: string
  selectedModules: SelectableResource[]
  duplicateStrategy: DuplicateStrategy
  lifecycle: ModuleLifecycleState
  sourceLabel?: string | null
  companyName?: string | null
  currency?: string | null
  companyIdOverride?: string
}): Promise<HydratedMigrationSession> {
  const companyId = input.companyIdOverride ?? await resolveCompanyId()
  // Refuse sandbox (or env-mismatched) connections before any session/job/queue work.
  const runtime = createAccountingIntegrationRuntime()
  await runtime.connections.assertMigrationConnectionReady(companyId, Provider.QUICKBOOKS)

  const existing = await findActiveQuickBooksMigrationSession(companyId)
  if (existing) {
    throw new FrameworkBadRequestError('Migration already running')
  }

  const config = buildSessionConfig({
    selectedModules: input.selectedModules,
    duplicateStrategy: input.duplicateStrategy,
    lifecycle: input.lifecycle,
    sourceLabel: input.sourceLabel,
    companyName: input.companyName,
    currency: input.currency,
    state: 'running',
  })

  const client = createAdminClient()
  const { data, error } = await client
    .from('migration_wizard_sessions')
    .insert({
      company_id: companyId,
      user_id: input.userId,
      step: 'import',
      status: 'IN_PROGRESS',
      config,
    })
    .select('*')
    .single()

  if (error) {
    // The partial unique index is the authoritative duplicate-click guard.
    // A concurrent request may win between the active-session read and insert;
    // return that durable session instead of creating a second migration.
    if (error.code === '23505') {
      const concurrent = await findActiveQuickBooksMigrationSession(companyId)
      if (concurrent) return concurrent
    }
    throw error
  }
  const created = await hydrateSession(mapSessionRow(data))
  // Job + queue row must exist before the response returns. The browser
  // coordinator is a fallback for later modules / resume — not the start path.
  return bootstrapQuickBooksMigrationQueue({
    session: created,
    userId: input.userId,
    companyIdOverride: companyId,
  })
}

/**
 * Creates the first import job (if needed) and inserts its queue row. Clicking
 * Migrate must not wait on React effects, polling, or a second browser round
 * trip before the worker can claim work.
 */
export async function bootstrapQuickBooksMigrationQueue(input: {
  session: HydratedMigrationSession
  userId: string
  companyIdOverride?: string
}): Promise<HydratedMigrationSession> {
  if (!isWorkerOwnedQuickBooksMigration(input.session.config)) return input.session

  const plan = planMigrationStartBootstrap(input.session)
  if (plan.type === 'none') return input.session

  const companyId = input.companyIdOverride ?? input.session.companyId ?? await resolveCompanyId()
  let session = input.session
  let importJobId = plan.module.jobId
  const moduleKey = plan.module.moduleKey

  if (plan.type === 'create-and-enqueue') {
    const module = plan.module
    const filename = `${session.config.sourceLabel ?? 'QuickBooks'} - ${module.label}`
    const duplicateStrategy = session.config.duplicateStrategy
    let created: Awaited<ReturnType<typeof createImportJob>>
    try {
      created = await createImportJob({
        userId: input.userId,
        moduleKey: module.moduleKey,
        filename,
        fileFormat: 'csv',
        duplicateStrategy,
        totalRows: 0,
        mappingSnapshot: {},
        payloadSnapshot: {
          sourceKey: session.config.provider,
          resourceKey: module.key,
          filename,
          fileFormat: 'csv',
          duplicateStrategy,
        },
        migrationSessionId: session.id,
        migrationResourceKey: module.key,
        companyId,
      })
    } catch (error) {
      if ((error as { code?: string })?.code !== '23505') throw error
      const existing = await getMigrationImportJob(session.id, module.key, companyId)
      if (!existing) throw error
      created = existing
    }
    if (!['completed', 'failed', 'cancelled'].includes(created.status)) {
      await setImportJobStatus(created.id, 'pending', companyId)
    }
    importJobId = created.id

    const lifecycle = applyJobCreated(session.lifecycle, module.key, created.id)
    session = await updateQuickBooksMigrationSession({
      sessionId: session.id,
      lifecycle,
      step: 'import',
      state: 'running',
      companyIdOverride: companyId,
    })

    logger.info('quickbooks.migration_session.bootstrap.job_created', {
      sessionId: session.id,
      companyId,
      importJobId: created.id,
      module: module.key,
    })
  }

  if (!importJobId) return session

  const client = createAdminClient()
  const { data: activeQueueJob, error: activeQueueError } = await client
    .from('job_queue')
    .select('id')
    .eq('company_id', companyId)
    .eq('job_type', 'QUICKBOOKS_IMPORT_STEP')
    .in('status', ['PENDING', 'RUNNING'])
    .contains('payload', { importJobId })
    .limit(1)
    .maybeSingle()
  if (activeQueueError) throw activeQueueError
  if (activeQueueJob) return session

  let queued
  try {
    queued = await enqueueJob({
      jobType: 'QUICKBOOKS_IMPORT_STEP',
      companyId,
      createdById: input.userId,
      payload: {
        importJobId,
        moduleKey,
        companyId,
        userId: input.userId,
      },
    })
  } catch (error) {
    // A second worker/completion hook may win the unique active-step race.
    if ((error as { code?: string })?.code !== '23505') throw error
    return session
  }

  logger.info('quickbooks.migration_session.bootstrap.enqueued', {
    sessionId: session.id,
    companyId,
    importJobId,
    platformJobId: String(queued.id),
    module: plan.module.key,
  })

  return session
}

/**
 * Worker-owned module advancement. A completed import step is the only event
 * that can schedule the next dependency-ready module; browser polling is not
 * part of this path. The unique migration-resource and active-queue indexes
 * make replayed completion hooks harmless.
 */
export async function advanceQuickBooksMigrationAfterImportJob(
  importJobId: string,
  companyId: string,
  userId: string,
): Promise<void> {
  try {
    const client = createAdminClient()
    const { data, error } = await client
      .from('migration_wizard_sessions')
      .select('*')
      .eq('company_id', companyId)
      .eq('status', 'IN_PROGRESS')
      .order('updated_at', { ascending: false })
      .limit(40)
    if (error) throw error

    const row = (data ?? []).find((candidate) => {
      if (!isQuickBooksMigrationConfig(candidate.config)) return false
      if (!isWorkerOwnedQuickBooksMigration(candidate.config)) return false
      return importJobIdsFromConfig(candidate.config).includes(importJobId)
    })
    if (!row) {
      logger.info('quickbooks.migration_session.advance_skipped', {
        reason: 'no_worker_owned_session',
        importJobId,
        companyId,
      })
      return
    }

    const { data: ownedJob, error: ownedJobError } = await client
      .from('import_jobs')
      .select('id,migration_session_id,status')
      .eq('id', importJobId)
      .eq('company_id', companyId)
      .maybeSingle()
    if (ownedJobError) throw ownedJobError
    if (!isImportJobOwnedByMigrationSession(row.id, row.config, importJobId, ownedJob)) {
      logger.info('quickbooks.migration_session.advance_skipped', {
        reason: 'import_job_not_owned_by_session',
        importJobId,
        companyId,
        sessionId: row.id,
        migrationSessionId: ownedJob?.migration_session_id ?? null,
      })
      return
    }

    const persistedStatus = ownedJob?.status == null ? null : String(ownedJob.status)
    if (!isTerminalImportJobStatus(persistedStatus)) {
      // If there's an active continuation queue row, include it for diagnosability.
      const client = createAdminClient()
      const { data: qrows } = await client
        .from('job_queue')
        .select('id,status,attempts')
        .eq('company_id', companyId)
        .eq('job_type', 'QUICKBOOKS_IMPORT_STEP')
        .filter("payload->>importJobId", 'eq', importJobId)
        .in('status', ['PENDING','RUNNING'])
        .order('updated_at', { ascending: false })
        .limit(1)
      const existing = qrows && qrows.length ? qrows[0] as any : null
      logger.info('quickbooks.migration_session.advance_skipped', {
        reason: 'import_job_not_terminal',
        importJobId,
        companyId,
        sessionId: row.id,
        status: persistedStatus,
        existingPlatformJobId: existing?.id ?? null,
        existingStatus: existing?.status ?? null,
        existingAttempts: existing?.attempts ?? null,
      })
      return
    }

    await backfillMigrationImportJobOwnership({
      sessionId: row.id,
      companyId,
      importJobId,
      config: row.config,
    })

    let session = await hydrateSession(mapSessionRow(row), { includeQueueHealth: false })
    const finished = Object.values(session.jobs).find((job) => job.id === importJobId)
    if (!finished || !isTerminalImportJobStatus(finished.status)) {
      logger.info('quickbooks.migration_session.advance_skipped', {
        reason: 'import_job_not_terminal',
        importJobId,
        companyId,
        sessionId: row.id,
        status: finished?.status ?? null,
      })
      return
    }

    if (!shouldAdvanceToNextMigrationModule(finished.status)) {
      await reconcileQuickBooksMigrationSession(session)
      return
    }

    const next = planMigrationStartBootstrap(session)
    if (next.type === 'none') {
      logger.info('quickbooks.migration_session.advance_skipped', {
        reason: 'no_next_module_planned',
        importJobId,
        companyId,
        sessionId: row.id,
        preferencesPhase: session.lifecycle.preferences?.phase ?? null,
      })
      session = await reconcileQuickBooksMigrationSession(session)
      return
    }

    await bootstrapQuickBooksMigrationQueue({ session, userId, companyIdOverride: companyId })
    logger.info('quickbooks.migration_session.worker_advanced', {
      sessionId: session.id,
      companyId,
      completedImportJobId: importJobId,
      nextModule: next.module.key,
    })
  } catch (error) {
    logger.error('quickbooks.migration_session.advance_failed', {
      importJobId,
      companyId,
      error: error instanceof Error
        ? { name: error.name, message: error.message }
        : { message: String(error) },
    })
    throw error
  }
}

export async function updateQuickBooksMigrationSession(input: {
  sessionId: string
  lifecycle?: ModuleLifecycleState
  selectedModules?: SelectableResource[]
  duplicateStrategy?: DuplicateStrategy
  step?: MigrationSessionStep
  state?: MigrationSessionState
  status?: MigrationSessionStatus
  companyIdOverride?: string
}): Promise<HydratedMigrationSession> {
  const companyId = input.companyIdOverride ?? await resolveCompanyId()
  const current = await getQuickBooksMigrationSession(input.sessionId, companyId)
  if (!current) throw new FrameworkNotFoundError('Migration session not found')

  const config: QuickBooksMigrationSessionConfig = buildSessionConfig({
    selectedModules: input.selectedModules ?? current.config.selectedModules,
    duplicateStrategy: input.duplicateStrategy ?? current.config.duplicateStrategy,
    lifecycle: input.lifecycle ?? current.lifecycle,
    startedAt: current.config.startedAt,
    sourceLabel: current.config.sourceLabel,
    companyName: current.config.companyName,
    currency: current.config.currency,
    orchestrationOwner: current.config.orchestrationOwner ?? 'browser_legacy',
    state: input.state ?? current.config.state,
  })

  let status = input.status ?? current.status
  if (input.state === 'completed' || input.state === 'failed') status = 'COMPLETED'
  if (input.state === 'cancelled') status = 'CANCELLED'

  const client = createAdminClient()
  const { data, error } = await client
    .from('migration_wizard_sessions')
    .update({
      step: input.step ?? current.step,
      status,
      config,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.sessionId)
    .eq('company_id', companyId)
    .select('*')
    .single()

  if (error) throw error
  return hydrateSession(mapSessionRow(data))
}

/** Cancels PENDING continuation queue rows only — never interrupts a RUNNING worker claim. */
async function cancelPendingContinuationJobs(importJobIds: string[], companyId: string): Promise<void> {
  if (importJobIds.length === 0) return
  const client = createAdminClient()
  const { error } = await client
    .from('job_queue')
    .update({
      status: 'CANCELLED',
      last_error: MIGRATION_CANCEL_CONFIRMATION,
      updated_at: new Date().toISOString(),
    })
    .eq('company_id', companyId)
    .eq('job_type', 'QUICKBOOKS_IMPORT_STEP')
    .eq('status', 'PENDING')
    .in('payload->>importJobId', importJobIds)
  if (error) throw error
}

/**
 * True when the migration session that owns this import job has been cancelled.
 * Used at step boundaries so the active batch can finish, then stop before the
 * next continuation is claimed or enqueued.
 */
export async function isImportJobMigrationCancelled(
  importJobId: string,
  companyIdOverride?: string,
): Promise<boolean> {
  const companyId = companyIdOverride ?? await resolveCompanyId()
  const client = createAdminClient()
  const { data, error } = await client
    .from('migration_wizard_sessions')
    .select('id, status, config')
    .eq('company_id', companyId)
    .order('updated_at', { ascending: false })
    .limit(40)
  if (error) throw error

  for (const row of data ?? []) {
    if (!isQuickBooksMigrationConfig(row.config)) continue
    if (!importJobIdsFromConfig(row.config).includes(importJobId)) continue
    return row.config.state === 'cancelled' || String(row.status) === 'CANCELLED'
  }
  return false
}

/**
 * Graceful cancel: persist CANCELLED on the session, cancel not-started modules
 * and their jobs, cancel PENDING continuation queue rows, and leave the active
 * processing job running until its current batch/checkpoint completes.
 */
export async function cancelQuickBooksMigrationSession(sessionId: string, companyIdOverride?: string): Promise<HydratedMigrationSession> {
  const companyId = companyIdOverride ?? await resolveCompanyId()
  const current = await getQuickBooksMigrationSession(sessionId, companyId)
  if (!current) throw new FrameworkNotFoundError('Migration session not found')
  if (!canCancelMigrationSession(current.config.state)) {
    throw new FrameworkBadRequestError(
      current.config.state === 'completed'
        ? 'Completed migrations cannot be cancelled.'
        : `Migration session cannot be cancelled while ${current.config.state}.`,
    )
  }

  const plan = planGracefulMigrationCancel(current.lifecycle, current.jobs, MIGRATION_CANCEL_CONFIRMATION)

  // Persist cancellation first so coordination and continuation gates stop immediately.
  const cancelled = await updateQuickBooksMigrationSession({
    sessionId,
    companyIdOverride: companyId,
    state: 'cancelled',
    status: 'CANCELLED',
    step: current.step,
    lifecycle: plan.lifecycle,
  })

  for (const jobId of plan.cancelJobIds) {
    await cancelImportJob(jobId, companyId)
  }

  const allJobIds = importJobIdsFromConfig(cancelled.config)
  await cancelPendingContinuationJobs(allJobIds, companyId)

  const refreshed = await getQuickBooksMigrationSession(sessionId, companyId)
  return refreshed ?? cancelled
}

export async function retryQuickBooksMigrationSession(sessionId: string, companyIdOverride?: string): Promise<HydratedMigrationSession> {
  const companyId = companyIdOverride ?? await resolveCompanyId()
  const current = await getQuickBooksMigrationSession(sessionId, companyId)
  if (!current) throw new FrameworkNotFoundError('Migration session not found')

  const resumableJobIds = Object.values(current.jobs)
    .filter((job) => job.status === 'failed' || job.status === 'cancelled')
    .map((job) => job.id)

  const hasCancelledModules = Object.values(current.lifecycle).some((entry) => entry.phase === 'cancelled')
  if (resumableJobIds.length === 0 && !hasCancelledModules && current.config.state !== 'cancelled') {
    throw new FrameworkBadRequestError('No failed or cancelled migration jobs are available to resume.')
  }

  for (const jobId of resumableJobIds) {
    await incrementImportJobRetry(jobId, companyId)
  }

  const refreshed = await getQuickBooksMigrationSession(sessionId, companyId)
  if (!refreshed) throw new FrameworkNotFoundError('Migration session not found')
  const retryLifecycle: ModuleLifecycleState = planResumeAfterCancellation(
    Object.fromEntries(
      Object.entries(refreshed.lifecycle).map(([key, entry]) => [
        key,
        entry.phase === 'failed'
          ? { ...entry, phase: 'queued' as const, failure: null }
          : entry,
      ]),
    ),
  )

  const resumed = await updateQuickBooksMigrationSession({
    sessionId,
    companyIdOverride: companyId,
    state: 'running',
    status: 'IN_PROGRESS',
    step: 'import',
    lifecycle: retryLifecycle,
  })

  if (!isWorkerOwnedQuickBooksMigration(resumed.config)) return resumed
  if (!resumed.userId) throw new FrameworkBadRequestError('Worker-owned migration cannot resume without an owning user.')
  return bootstrapQuickBooksMigrationQueue({
    session: resumed,
    userId: resumed.userId,
    companyIdOverride: companyId,
  })
}
