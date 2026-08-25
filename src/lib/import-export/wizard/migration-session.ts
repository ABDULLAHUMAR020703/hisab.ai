import type { DuplicateStrategy } from '../types'
import {
  applyJobSnapshot,
  initializeModuleLifecycle,
  orderedModules,
  type ModuleLifecycleEntry,
  type ModuleLifecyclePhase,
  type ModuleLifecycleState,
  type ModuleWorkEstimate,
  type PersistedImportJobSnapshot,
  type SelectableResource,
} from './module-lifecycle'
import type {
  MigrationQueueHealth,
  MigrationQueueHealthThresholds,
  PersistedQueueJobSnapshot,
} from './migration-queue-health'

export const QUICKBOOKS_MIGRATION_SESSION_KIND = 'quickbooks_migration' as const
export const QUICKBOOKS_MIGRATION_ORCHESTRATION_OWNER = 'worker' as const
export type QuickBooksMigrationOrchestrationOwner = 'worker' | 'browser_legacy'

export type MigrationSessionState = 'running' | 'completed' | 'failed' | 'cancelled'
export type MigrationSessionStep = 'analyze' | 'modules' | 'validation' | 'import' | 'report'
export type MigrationSessionStatus = 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'

/** Compact module card stored in the session. Live progress always comes from import_jobs. */
export interface PersistedModuleCard {
  key: string
  moduleKey: string
  label: string
  order: number
  phase: ModuleLifecyclePhase
  jobId: string | null
  estimate: ModuleWorkEstimate | null
  preview: ModuleLifecycleEntry['preview']
  failure: ModuleLifecycleEntry['failure']
  unsupported: ModuleLifecycleEntry['unsupported']
  warningCount: number
}

export interface QuickBooksMigrationSessionConfig {
  kind: typeof QUICKBOOKS_MIGRATION_SESSION_KIND
  provider: 'quickbooks'
  state: MigrationSessionState
  selectedModules: SelectableResource[]
  duplicateStrategy: DuplicateStrategy
  modules: PersistedModuleCard[]
  importJobIds: Record<string, string>
  startedAt: string
  sourceLabel?: string | null
  companyName?: string | null
  currency?: string | null
  /** New sessions are worker-owned; omitted on historical browser-coordinated sessions. */
  orchestrationOwner?: QuickBooksMigrationOrchestrationOwner
}

export interface MigrationSessionRecord {
  id: string
  companyId: string
  userId: string | null
  step: MigrationSessionStep
  status: MigrationSessionStatus
  config: QuickBooksMigrationSessionConfig
  createdAt: string
  updatedAt: string
}

export interface HydratedMigrationSession extends MigrationSessionRecord {
  jobs: Record<string, PersistedImportJobSnapshot & { id: string; moduleKey: string }>
  queueJobs?: Record<string, PersistedQueueJobSnapshot>
  queueHealth?: Record<string, MigrationQueueHealth>
  queueHealthThresholds?: MigrationQueueHealthThresholds
  lifecycle: ModuleLifecycleState
}

/** Compact row for Migration History — derived only from persisted session + jobs. */
export interface MigrationHistorySummary {
  id: string
  provider: 'quickbooks'
  status: MigrationSessionState
  startedAt: string
  completedAt: string | null
  durationMs: number
  moduleCount: number
  modules: Array<{ key: string; label: string; phase: ModuleLifecyclePhase }>
  importedCount: number
  updatedCount: number
  skippedCount: number
  failedCount: number
  warningCount: number
  sourceLabel: string | null
  companyName: string | null
  updatedAt: string
}

export function summarizeMigrationSession(session: HydratedMigrationSession): MigrationHistorySummary {
  const modules = orderedModules(session.lifecycle)
  const startedAt = session.config.startedAt || session.createdAt
  const terminal = session.config.state !== 'running'
  const completedAt = terminal ? session.updatedAt : null
  const durationMs = Math.max(
    0,
    (completedAt ? Date.parse(completedAt) : Date.now()) - Date.parse(startedAt),
  )
  let importedCount = 0
  let updatedCount = 0
  let skippedCount = 0
  let failedCount = 0
  let warningCount = 0
  for (const entry of modules) {
    importedCount += entry.progress?.importedCount ?? 0
    updatedCount += entry.progress?.updatedCount ?? 0
    skippedCount += entry.progress?.skippedCount ?? 0
    failedCount += entry.progress?.failedCount ?? 0
    warningCount += entry.warningCount ?? 0
  }
  return {
    id: session.id,
    provider: 'quickbooks',
    status: session.config.state,
    startedAt,
    completedAt,
    durationMs,
    moduleCount: modules.length,
    modules: modules.map((entry) => ({ key: entry.key, label: entry.label, phase: entry.phase })),
    importedCount,
    updatedCount,
    skippedCount,
    failedCount,
    warningCount,
    sourceLabel: session.config.sourceLabel ?? null,
    companyName: session.config.companyName ?? null,
    updatedAt: session.updatedAt,
  }
}

export function isQuickBooksMigrationConfig(value: unknown): value is QuickBooksMigrationSessionConfig {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return record.kind === QUICKBOOKS_MIGRATION_SESSION_KIND && record.provider === 'quickbooks'
}

export function isActiveMigrationSession(session: Pick<MigrationSessionRecord, 'status' | 'config'>): boolean {
  return session.status === 'IN_PROGRESS' && isQuickBooksMigrationConfig(session.config) && session.config.state === 'running'
}

export function isWorkerOwnedQuickBooksMigration(
  config: Pick<QuickBooksMigrationSessionConfig, 'orchestrationOwner'>,
): boolean {
  return config.orchestrationOwner === QUICKBOOKS_MIGRATION_ORCHESTRATION_OWNER
}

export function serializeModuleCards(lifecycle: ModuleLifecycleState): PersistedModuleCard[] {
  return orderedModules(lifecycle).map((entry) => ({
    key: entry.key,
    moduleKey: entry.moduleKey,
    label: entry.label,
    order: entry.order,
    phase: entry.phase,
    jobId: entry.jobId,
    estimate: entry.estimate,
    preview: entry.preview,
    failure: entry.failure,
    unsupported: entry.unsupported,
    warningCount: entry.warningCount,
  }))
}

export function buildSessionConfig(input: {
  selectedModules: SelectableResource[]
  duplicateStrategy: DuplicateStrategy
  lifecycle: ModuleLifecycleState
  startedAt?: string
  sourceLabel?: string | null
  companyName?: string | null
  currency?: string | null
  state?: MigrationSessionState
  orchestrationOwner?: QuickBooksMigrationOrchestrationOwner
}): QuickBooksMigrationSessionConfig {
  const modules = serializeModuleCards(input.lifecycle)
  const importJobIds: Record<string, string> = {}
  for (const entry of modules) {
    if (entry.jobId) importJobIds[entry.key] = entry.jobId
  }
  return {
    kind: QUICKBOOKS_MIGRATION_SESSION_KIND,
    provider: 'quickbooks',
    state: input.state ?? 'running',
    selectedModules: input.selectedModules,
    duplicateStrategy: input.duplicateStrategy,
    modules,
    importJobIds,
    startedAt: input.startedAt ?? new Date().toISOString(),
    sourceLabel: input.sourceLabel ?? null,
    companyName: input.companyName ?? null,
    currency: input.currency ?? null,
    orchestrationOwner: input.orchestrationOwner ?? QUICKBOOKS_MIGRATION_ORCHESTRATION_OWNER,
  }
}

/**
 * Rebuilds the permanent lifecycle cards from the session roster, then overlays
 * every persisted import_jobs row. Progress, ETA, activity, and phase always
 * come from the jobs — never from React memory.
 */
export function restoreLifecycleFromSession(
  config: QuickBooksMigrationSessionConfig,
  jobs: Record<string, PersistedImportJobSnapshot & { id?: string }>,
): ModuleLifecycleState {
  const base = initializeModuleLifecycle(config.selectedModules.length > 0
    ? config.selectedModules
    : config.modules.map((module) => ({ key: module.key, label: module.label, moduleKey: module.moduleKey })))

  let state: ModuleLifecycleState = {}
  for (const card of config.modules) {
    const existing = base[card.key] ?? {
      key: card.key,
      moduleKey: card.moduleKey,
      label: card.label,
      order: card.order,
      phase: 'selected' as const,
      jobId: null,
      estimate: null,
      preview: null,
      failure: null,
      unsupported: null,
      progress: null,
      queuePosition: null,
      durationMs: null,
      warningCount: 0,
    }
    state[card.key] = {
      ...existing,
      order: card.order,
      phase: card.phase,
      jobId: card.jobId ?? config.importJobIds[card.key] ?? null,
      estimate: card.estimate,
      preview: card.preview,
      failure: card.failure,
      unsupported: card.unsupported,
      warningCount: card.warningCount,
    }
  }

  // Include any selected module that somehow lacked a card.
  for (const [key, entry] of Object.entries(base)) {
    if (!state[key]) state[key] = entry
  }

  for (const [key, entry] of Object.entries(state)) {
    const jobId = entry.jobId ?? config.importJobIds[key]
    if (!jobId) continue
    const job = jobs[key] ?? Object.values(jobs).find((candidate) => candidate.id === jobId)
    if (!job) {
      state = {
        ...state,
        [key]: { ...entry, jobId, phase: entry.phase === 'ready' ? 'queued' : entry.phase },
      }
      continue
    }
    state = applyJobSnapshot({ ...state, [key]: { ...entry, jobId } }, key, job)
  }

  return state
}

export function importJobIdsFromConfig(config: QuickBooksMigrationSessionConfig): string[] {
  const ids = new Set<string>()
  for (const id of Object.values(config.importJobIds)) {
    if (id) ids.add(id)
  }
  for (const card of config.modules) {
    if (card.jobId) ids.add(card.jobId)
  }
  return [...ids]
}

/** Maps an import_jobs row into the polling snapshot the wizard already understands. */
export function jobRecordToProgressSnapshot(job: {
  id: string
  moduleKey: string
  status: string
  totalRows: number
  processedRows: number
  importedCount: number
  updatedCount: number
  skippedCount: number
  failedCount: number
  warningCount?: number | null
  invalidRows?: number | null
  durationMs?: number | null
  createdAt?: string | null
  updatedAt?: string | null
  startedAt?: string | null
  pausedAt?: string | null
  lastHeartbeatAt?: string | null
  batchSize?: number
  progressSnapshot?: PersistedImportJobSnapshot['progressSnapshot'] | null
  activityEvents?: PersistedImportJobSnapshot['activityEvents']
  skipSummary?: Record<string, number> | null
}): PersistedImportJobSnapshot & { id: string; moduleKey: string } {
  const completed = job.status === 'completed'
  const persistedOutcomeRows = job.importedCount + job.updatedCount + job.skippedCount + job.failedCount
  const snapshot = completed
    ? {
      ...(job.progressSnapshot ?? {}),
      processedRecords: persistedOutcomeRows,
      importedCount: job.importedCount,
      updatedCount: job.updatedCount,
      skippedCount: job.skippedCount,
      failedCount: job.failedCount,
      progressPercent: 100,
    }
    : (job.progressSnapshot ?? {})
  const processedRows = completed ? persistedOutcomeRows : Math.max(snapshot.processedRecords ?? 0, job.processedRows)
  const totalRows = Math.max(snapshot.estimatedTotalRecords ?? 0, job.totalRows, processedRows)
  const startedAt = snapshot.startedAt ?? job.startedAt
  const elapsedMs = startedAt ? Math.max(0, Date.now() - new Date(startedAt).getTime()) : (job.durationMs ?? 0)
  const remaining = completed ? 0 : (totalRows > processedRows ? totalRows - processedRows : null)
  const secondsRemaining = remaining !== null && (snapshot.averageThroughput ?? 0) > 0
    ? remaining / Number(snapshot.averageThroughput)
    : null
  const livePercent = totalRows ? Math.min(100, Math.round((processedRows / totalRows) * 10000) / 100) : 0
  const progressPercent = completed
    ? 100
    : Math.min(99.99, Math.max(Number(snapshot.progressPercent ?? 0), livePercent))
  const visibleSnapshot = completed
    ? snapshot
    : { ...snapshot, progressPercent }
  const batchSize = Math.max(1, job.batchSize ?? 250)

  return {
    id: job.id,
    moduleKey: job.moduleKey,
    status: job.status,
    createdAt: job.createdAt ?? null,
    updatedAt: job.updatedAt ?? null,
    startedAt: job.startedAt ?? null,
    pausedAt: job.pausedAt ?? null,
    lastHeartbeatAt: job.lastHeartbeatAt ?? null,
    totalRows,
    processedRows,
    importedCount: snapshot.importedCount ?? job.importedCount,
    updatedCount: snapshot.updatedCount ?? job.updatedCount,
    skippedCount: snapshot.skippedCount ?? job.skippedCount,
    failedCount: snapshot.failedCount ?? job.failedCount,
    warningCount: job.warningCount ?? null,
    invalidRows: job.invalidRows ?? null,
    durationMs: job.durationMs ?? null,
    progressPercent,
    currentStage: snapshot.currentStage ?? null,
    currentRecord: snapshot.currentRecord ?? null,
    currentBatch: snapshot.currentBatch ?? (Math.floor(processedRows / batchSize) + 1),
    totalBatches: snapshot.totalBatches ?? (totalRows ? Math.ceil(totalRows / batchSize) : null),
    elapsedMs,
    throughput: snapshot.throughput ?? null,
    averageThroughput: snapshot.averageThroughput ?? null,
    estimatedRemaining: remaining,
    estimatedRemainingSeconds: secondsRemaining,
    estimatedCompletionAt: secondsRemaining === null ? null : new Date(Date.now() + secondsRemaining * 1000).toISOString(),
    activityEvents: job.activityEvents ?? [],
    progressSnapshot: visibleSnapshot,
    skipSummary: job.skipSummary ?? null,
  }
}
