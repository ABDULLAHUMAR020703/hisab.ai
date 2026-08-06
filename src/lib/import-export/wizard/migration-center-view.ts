import { buildMigrationReport, type MigrationReport } from '../migration-report'
import type { HydratedMigrationSession, MigrationHistorySummary } from './migration-session'
import { summarizeMigrationSession } from './migration-session'
import {
  activeModule,
  deriveOverallProgress,
  MODULE_PHASE_LABEL,
  orderedModules,
  type ModuleLifecycleEntry,
  type OverallMigrationProgress,
} from './module-lifecycle'
import type { MigrationActivityEvent } from '../types'
import type {
  MigrationExecutionState,
  MigrationQueueHealth,
} from './migration-queue-health'
import { canCancelMigrationSession } from './migration-cancel'
import {
  deriveMigrationTiming,
  ETA_ESTIMATING_LABEL,
  formatTimingDuration,
  type MigrationTimingWaterfallEntry,
} from './migration-timing'
import {
  buildMigrationActivityTimeline,
  type MigrationTimelineEntry,
} from './migration-activity-timeline'

/**
 * Pure view-model for the Migration Center.
 * Every field is derived from the hydrated session (DB session + import_jobs).
 * Never invent progress from transient React state.
 */
export interface MigrationCenterView {
  sessionId: string
  provider: 'quickbooks'
  status: HydratedMigrationSession['config']['state']
  sourceLabel: string | null
  companyName: string | null
  startedAt: string
  completedAt: string | null
  overall: OverallMigrationProgress
  currentModule: ModuleLifecycleEntry | null
  currentStage: string | null
  currentRecord: string | null
  currentBatch: number | null
  totalBatches: number | null
  elapsedMs: number
  activeProcessingMs: number
  queueWaitMs: number
  idleMs: number
  databaseWaitMs: number
  apiWaitMs: number
  remainingMs: number | null
  etaLabel: string
  timingWaterfall: MigrationTimingWaterfallEntry[]
  completedModules: ModuleLifecycleEntry[]
  cancelledModules: ModuleLifecycleEntry[]
  remainingModules: ModuleLifecycleEntry[]
  queuedModules: ModuleLifecycleEntry[]
  processingModules: ModuleLifecycleEntry[]
  failedModules: ModuleLifecycleEntry[]
  allModules: ModuleLifecycleEntry[]
  canCancel: boolean
  cancellingActiveBatch: boolean
  activityTimeline: MigrationTimelineEntry[]
  performance: {
    averageThroughput: number | null
    apiRequests: number
    databaseQueries: number
    databaseWrites: number
    databaseTimeMs: number
    retryCount: number
    memoryBytes: number | null
  }
  workerStatus: MigrationExecutionState | 'idle'
  executionHealth: MigrationQueueHealth | null
  moduleExecutionHealth: Record<string, MigrationQueueHealth>
  queueStatus: {
    depth: number
    nextLabel: string | null
    waitingMs: number
    lastQueueUpdateAt: string | null
  }
  warnings: Array<{ module: string; count: number }>
  errors: Array<{ module: string; message: string; stage: string | null; errorCode: string | null }>
  logs: MigrationActivityEvent[]
  finalReport: MigrationReport | null
  historySummary: MigrationHistorySummary
}

function formatDuration(milliseconds: number): string {
  return formatTimingDuration(milliseconds)
}

export function formatMigrationDuration(milliseconds: number): string {
  return formatDuration(milliseconds)
}

export { ETA_ESTIMATING_LABEL }

function fallbackExecutionHealth(
  entry: ModuleLifecycleEntry | null,
  sessionState: HydratedMigrationSession['config']['state'],
): MigrationQueueHealth | null {
  const state: MigrationExecutionState | null = entry
    ? entry.phase === 'claimed' ? 'worker_claimed'
      : entry.phase === 'processing' ? 'processing'
        : entry.phase === 'paused' ? 'paused'
          : entry.phase === 'completed' || entry.phase === 'completed_with_warnings' ? 'completed'
            : entry.phase === 'failed' || entry.phase === 'cancelled' ? 'failed'
              : 'queued'
    : sessionState === 'completed' ? 'completed'
      : sessionState === 'failed' || sessionState === 'cancelled' ? 'failed'
        : null
  if (!state) return null
  const label: Record<MigrationExecutionState, string> = {
    queued: 'Queued',
    worker_claimed: 'Worker Claimed',
    processing: 'Processing',
    paused: 'Paused',
    completed: 'Completed',
    failed: 'Failed',
  }
  return {
    state,
    label: label[state],
    warning: null,
    warningMessage: null,
    waitingSince: null,
    waitingMs: 0,
    lastQueueUpdateAt: null,
    workerClaimedAt: null,
    lastHeartbeatAt: null,
    suggestedAction: null,
    retryAppropriate: state === 'failed',
  }
}

export function buildMigrationCenterView(
  session: HydratedMigrationSession,
  nowMs: number = Date.now(),
  options: { includeHeavy?: boolean } = {},
): MigrationCenterView {
  const includeHeavy = options.includeHeavy !== false
  const modules = orderedModules(session.lifecycle)
  const overall = deriveOverallProgress(session.lifecycle)
  const current = activeModule(session.lifecycle)
  const progress = current?.progress ?? null
  const timing = deriveMigrationTiming(session, nowMs)

  const rawLogs: MigrationActivityEvent[] = []
  if (includeHeavy) {
    for (const entry of modules) {
      for (const event of entry.progress?.activityEvents ?? []) {
        rawLogs.push({ ...event, module: event.module ?? entry.label })
      }
    }
    rawLogs.sort((left, right) => Date.parse(right.at) - Date.parse(left.at))
  }
  const activityTimeline = includeHeavy ? buildMigrationActivityTimeline(session) : []

  const snapshot = progress?.progressSnapshot ?? {}
  const startedAt = timing.startedAt
  const terminal = session.config.state !== 'running'
  const completedAt = timing.completedAt

  const warnings = modules
    .filter((entry) => (entry.warningCount ?? 0) > 0)
    .map((entry) => ({ module: entry.label, count: entry.warningCount }))

  const errors = modules
    .filter((entry) => entry.failure || entry.phase === 'failed' || entry.phase === 'preview_failed')
    .map((entry) => ({
      module: entry.label,
      message: entry.failure?.message ?? MODULE_PHASE_LABEL[entry.phase],
      stage: entry.failure?.stage ?? entry.progress?.currentStage ?? null,
      errorCode: entry.failure?.errorCode ?? null,
    }))

  const queued = modules.filter((entry) => entry.phase === 'queued')
  const cancelled = modules.filter((entry) => entry.phase === 'cancelled')
  const hasExecutionEvidence = (entry: ModuleLifecycleEntry) => Boolean(
    entry.progress
    && (
      entry.progress.processedRows > 0
      || entry.progress.currentStage
      || entry.progress.activityEvents.length > 0
    ),
  )
  const cancelledAfterExecution = cancelled.filter(hasExecutionEvidence)
  const remainingNotExecuted = modules.filter((entry) =>
    entry.phase === 'queued'
    || entry.phase === 'ready'
    || entry.phase === 'selected'
    || (entry.phase === 'cancelled' && !hasExecutionEvidence(entry)))
  const executionModule = current ?? queued[0] ?? modules.find((entry) => entry.phase === 'failed') ?? null
  const moduleExecutionHealth: Record<string, MigrationQueueHealth> = {}
  for (const entry of modules) {
    const health = session.queueHealth?.[entry.key] ?? fallbackExecutionHealth(entry, session.config.state)
    if (health) moduleExecutionHealth[entry.key] = health
  }
  const executionHealth = executionModule
    ? moduleExecutionHealth[executionModule.key] ?? fallbackExecutionHealth(executionModule, session.config.state)
    : fallbackExecutionHealth(null, session.config.state)
  const workerStatus = executionHealth?.state ?? 'idle'
  const finalReport = includeHeavy && terminal
    ? buildMigrationReport({
      source: session.config.sourceLabel ?? 'QuickBooks',
      companyName: session.config.companyName,
      currency: session.config.currency,
      durationMs: timing.elapsedMs,
      modules: modules.map((entry) => ({
        key: entry.key,
        label: entry.label,
        sourceCount: entry.progress?.totalRows ?? entry.estimate?.records ?? 0,
        validCount: Math.max(
          0,
          (entry.progress?.totalRows ?? entry.estimate?.records ?? 0) - (entry.progress?.failedCount ?? 0),
        ),
        warningCount: entry.warningCount ?? 0,
        validationErrors: 0,
        importedCount: entry.progress?.importedCount ?? 0,
        updatedCount: entry.progress?.updatedCount ?? 0,
        skippedCount: entry.progress?.skippedCount ?? 0,
        failedCount: entry.progress?.failedCount ?? 0,
        durationMs: entry.durationMs
          ?? (Number(entry.progress?.progressSnapshot?.activeProcessingMs) || 0),
      })),
    })
    : null

  return {
    sessionId: session.id,
    provider: 'quickbooks',
    status: session.config.state,
    sourceLabel: session.config.sourceLabel ?? null,
    companyName: session.config.companyName ?? null,
    startedAt,
    completedAt,
    overall,
    currentModule: current,
    currentStage: progress?.currentStage ?? current?.phase ?? null,
    currentRecord: progress?.currentRecord ?? null,
    currentBatch: progress?.currentBatch ?? null,
    totalBatches: progress?.totalBatches ?? null,
    elapsedMs: timing.elapsedMs,
    activeProcessingMs: timing.activeProcessingMs,
    queueWaitMs: timing.queueWaitMs,
    idleMs: timing.idleMs,
    databaseWaitMs: timing.databaseTimeMs,
    apiWaitMs: timing.apiTimeMs,
    remainingMs: timing.remainingMs,
    etaLabel: timing.etaLabel,
    timingWaterfall: timing.waterfall,
    completedModules: modules.filter((entry) =>
      entry.phase === 'completed' || entry.phase === 'completed_with_warnings'),
    cancelledModules: cancelledAfterExecution,
    remainingModules: remainingNotExecuted,
    queuedModules: queued,
    processingModules: modules.filter((entry) =>
      entry.phase === 'processing' || entry.phase === 'claimed' || entry.phase === 'paused'),
    failedModules: modules.filter((entry) =>
      entry.phase === 'failed' || entry.phase === 'preview_failed'),
    allModules: modules,
    canCancel: canCancelMigrationSession(session.config.state),
    cancellingActiveBatch: session.config.state === 'cancelled'
      && modules.some((entry) => entry.phase === 'processing' || entry.phase === 'claimed'),
    activityTimeline,
    performance: {
      averageThroughput: timing.completedThroughput,
      apiRequests: snapshot.apiRequests ?? 0,
      databaseQueries: snapshot.databaseQueries ?? 0,
      databaseWrites: snapshot.databaseWrites ?? 0,
      databaseTimeMs: snapshot.databaseTimeMs ?? 0,
      retryCount: snapshot.retryCount ?? 0,
      memoryBytes: snapshot.memoryBytes ?? null,
    },
    workerStatus,
    executionHealth,
    moduleExecutionHealth,
    queueStatus: {
      depth: queued.length,
      nextLabel: queued[0]?.label ?? null,
      waitingMs: executionHealth?.state === 'queued' ? executionHealth.waitingMs : 0,
      lastQueueUpdateAt: executionHealth?.lastQueueUpdateAt ?? null,
    },
    warnings,
    errors,
    logs: rawLogs,
    finalReport,
    historySummary: summarizeMigrationSession(session),
  }
}

export function migrationCenterPath(sessionId: string): string {
  return `/migration-center/${sessionId}`
}
