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
  remainingMs: number | null
  etaLabel: string
  completedModules: ModuleLifecycleEntry[]
  queuedModules: ModuleLifecycleEntry[]
  processingModules: ModuleLifecycleEntry[]
  failedModules: ModuleLifecycleEntry[]
  allModules: ModuleLifecycleEntry[]
  activityTimeline: MigrationActivityEvent[]
  performance: {
    averageThroughput: number | null
    apiRequests: number
    databaseQueries: number
    databaseWrites: number
    databaseTimeMs: number
    retryCount: number
    memoryBytes: number | null
  }
  workerStatus: 'idle' | 'running' | 'failed' | 'completed'
  queueStatus: { depth: number; nextLabel: string | null }
  warnings: Array<{ module: string; count: number }>
  errors: Array<{ module: string; message: string; stage: string | null; errorCode: string | null }>
  logs: MigrationActivityEvent[]
  finalReport: MigrationReport | null
  historySummary: MigrationHistorySummary
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  if (hours > 0) return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`
  return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`
}

export function formatMigrationDuration(milliseconds: number): string {
  return formatDuration(milliseconds)
}

export function buildMigrationCenterView(session: HydratedMigrationSession): MigrationCenterView {
  const modules = orderedModules(session.lifecycle)
  const overall = deriveOverallProgress(session.lifecycle)
  const current = activeModule(session.lifecycle)
  const progress = current?.progress ?? null
  const finishedElapsedMs = modules.reduce((sum, entry) => sum + (entry.durationMs ?? 0), 0)
  const elapsedMs = finishedElapsedMs + (progress?.elapsedMs ?? 0)
  const queuedRemainingMs = modules
    .filter((entry) => entry.phase === 'queued')
    .reduce((sum, entry) => sum + (entry.estimate?.durationMs ?? 0), 0)
  const activeRemainingMs = progress?.estimatedRemainingSeconds == null
    ? null
    : progress.estimatedRemainingSeconds * 1000
  const remainingMs = activeRemainingMs === null
    ? (queuedRemainingMs > 0 ? queuedRemainingMs : null)
    : activeRemainingMs + queuedRemainingMs

  const timeline: MigrationActivityEvent[] = []
  for (const entry of modules) {
    for (const event of entry.progress?.activityEvents ?? []) {
      timeline.push({ ...event, module: event.module ?? entry.label })
    }
  }
  timeline.sort((left, right) => Date.parse(right.at) - Date.parse(left.at))

  const snapshot = progress?.progressSnapshot ?? {}
  const startedAt = session.config.startedAt || session.createdAt
  const terminal = session.config.state !== 'running'
  const completedAt = terminal ? session.updatedAt : null

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

  let workerStatus: MigrationCenterView['workerStatus'] = 'idle'
  if (session.config.state === 'completed') workerStatus = 'completed'
  else if (session.config.state === 'failed') workerStatus = 'failed'
  else if (overall.processing > 0) workerStatus = 'running'

  const queued = modules.filter((entry) => entry.phase === 'queued')
  const finalReport = terminal
    ? buildMigrationReport({
      source: session.config.sourceLabel ?? 'QuickBooks',
      companyName: session.config.companyName,
      currency: session.config.currency,
      durationMs: Math.max(0, Date.parse(completedAt ?? session.updatedAt) - Date.parse(startedAt)),
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
        durationMs: entry.durationMs ?? entry.progress?.elapsedMs ?? 0,
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
    elapsedMs,
    remainingMs,
    etaLabel: remainingMs === null ? 'Calculating…' : formatDuration(remainingMs),
    completedModules: modules.filter((entry) =>
      entry.phase === 'completed' || entry.phase === 'completed_with_warnings'),
    queuedModules: queued,
    processingModules: modules.filter((entry) =>
      entry.phase === 'processing' || entry.phase === 'claimed' || entry.phase === 'paused'),
    failedModules: modules.filter((entry) =>
      entry.phase === 'failed' || entry.phase === 'preview_failed' || entry.phase === 'cancelled'),
    allModules: modules,
    activityTimeline: timeline.slice(0, 50),
    performance: {
      averageThroughput: progress?.averageThroughput ?? null,
      apiRequests: snapshot.apiRequests ?? 0,
      databaseQueries: snapshot.databaseQueries ?? 0,
      databaseWrites: snapshot.databaseWrites ?? 0,
      databaseTimeMs: snapshot.databaseTimeMs ?? 0,
      retryCount: snapshot.retryCount ?? 0,
      memoryBytes: snapshot.memoryBytes ?? null,
    },
    workerStatus,
    queueStatus: {
      depth: queued.length,
      nextLabel: queued[0]?.label ?? null,
    },
    warnings,
    errors,
    logs: timeline,
    finalReport,
    historySummary: summarizeMigrationSession(session),
  }
}

export function migrationCenterPath(sessionId: string): string {
  return `/migration-center/${sessionId}`
}
