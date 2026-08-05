import type { MigrationActivityEvent, MigrationProgressSnapshot } from '../types'

/**
 * Permanent lifecycle state for every module the user selected in the Migration
 * Wizard. Entries are created at selection time and are never removed, so a
 * module can never silently disappear from the UI. Every phase after a job
 * exists is derived from the persisted `import_jobs` row.
 */
export type ModuleLifecyclePhase =
  | 'selected'
  | 'previewing'
  | 'ready'
  | 'unsupported'
  | 'preview_failed'
  | 'queued'
  | 'claimed'
  | 'processing'
  | 'paused'
  | 'completed'
  | 'completed_with_warnings'
  | 'failed'
  | 'cancelled'

export const MODULE_PHASE_LABEL: Record<ModuleLifecyclePhase, string> = {
  selected: 'Selected',
  previewing: 'Previewing',
  ready: 'Ready',
  unsupported: 'Unsupported',
  preview_failed: 'Preview Failed',
  queued: 'Waiting in Queue',
  claimed: 'Worker Claimed',
  processing: 'Processing',
  paused: 'Paused',
  completed: 'Completed',
  completed_with_warnings: 'Completed with Warnings',
  failed: 'Failed',
  cancelled: 'Cancelled',
}

const TERMINAL_PHASES = new Set<ModuleLifecyclePhase>(['completed', 'completed_with_warnings', 'failed', 'cancelled'])
const EXCLUDED_FROM_MIGRATION = new Set<ModuleLifecyclePhase>(['unsupported', 'preview_failed'])
const NON_RETRYABLE_PREVIEW_CODES = new Set(['ADAPTER_RESOURCE_MISSING', 'MODULE_NOT_REGISTERED', 'MODULE_UNSUPPORTED'])

/** Source pages are materialized one provider page at a time by the import route. */
export const SOURCE_PAGE_SIZE = 100
// Sandbox baseline (test-data/quickbooks-sandbox-migration-report.json): master and
// transaction modules averaged ~0.6 records/second plus fixed provider overhead.
const BASELINE_RECORDS_PER_SECOND = 0.6
const MODULE_OVERHEAD_MS = 3_000

export interface ModuleWorkEstimate {
  records: number
  batches: number
  durationMs: number
}

export interface ModuleProgressView {
  processedRows: number
  totalRows: number
  importedCount: number
  updatedCount: number
  skippedCount: number
  failedCount: number
  progressPercent: number
  currentStage: string | null
  currentRecord: string | null
  currentBatch: number
  totalBatches: number | null
  elapsedMs: number
  throughput: number | null
  averageThroughput: number | null
  estimatedRemaining: number | null
  estimatedRemainingSeconds: number | null
  estimatedCompletionAt: string | null
  activityEvents: MigrationActivityEvent[]
  progressSnapshot: MigrationProgressSnapshot
}

export interface ModuleLifecycleEntry {
  key: string
  moduleKey: string
  label: string
  order: number
  phase: ModuleLifecyclePhase
  jobId: string | null
  estimate: ModuleWorkEstimate | null
  preview: { sampleRowCount: number; sampleErrorCount: number; countAccuracy: 'exact' | 'upper-bound' | null } | null
  failure: {
    message: string
    stage: string | null
    errorCode: string | null
    correlationId: string | null
    retryable: boolean
  } | null
  unsupported: { message: string; documentationUrl: string | null } | null
  progress: ModuleProgressView | null
  queuePosition: number | null
  durationMs: number | null
  warningCount: number
}

export type ModuleLifecycleState = Record<string, ModuleLifecycleEntry>

export interface SelectableResource {
  key: string
  label: string
  moduleKey: string
}

export interface PreviewResultLike {
  key: string
  label?: string
  moduleKey?: string
  status: 'success' | 'error' | 'unsupported'
  count?: number
  countAccuracy?: 'exact' | 'upper-bound'
  sampleRows?: unknown[]
  validation?: { errorCount?: number }
  stage?: string
  errorCode?: string
  message?: string
  correlationId?: string
  documentationUrl?: string | null
}

export interface PersistedImportJobSnapshot {
  status: string
  totalRows?: number
  processedRows?: number
  importedCount?: number
  updatedCount?: number
  skippedCount?: number
  failedCount?: number
  warningCount?: number | null
  invalidRows?: number | null
  durationMs?: number | null
  progressPercent?: number
  currentStage?: string | null
  currentRecord?: string | null
  currentBatch?: number
  totalBatches?: number | null
  elapsedMs?: number
  throughput?: number | null
  averageThroughput?: number | null
  estimatedRemaining?: number | null
  estimatedRemainingSeconds?: number | null
  estimatedCompletionAt?: string | null
  activityEvents?: MigrationActivityEvent[]
  progressSnapshot?: MigrationProgressSnapshot
}

export function isTerminalPhase(phase: ModuleLifecyclePhase): boolean {
  return TERMINAL_PHASES.has(phase)
}

export function participatesInMigration(entry: ModuleLifecycleEntry): boolean {
  return !EXCLUDED_FROM_MIGRATION.has(entry.phase)
}

export function estimateModuleWork(records: number, throughput?: number | null): ModuleWorkEstimate {
  const safeRecords = Math.max(0, Math.round(records))
  const rate = throughput && throughput > 0 ? throughput : BASELINE_RECORDS_PER_SECOND
  return {
    records: safeRecords,
    batches: Math.max(1, Math.ceil(safeRecords / SOURCE_PAGE_SIZE)),
    durationMs: MODULE_OVERHEAD_MS + Math.round((safeRecords / rate) * 1000),
  }
}

/** Persisted import job status -> lifecycle phase. This is the single source of truth. */
export function derivePhaseFromPersistedJob(snapshot: PersistedImportJobSnapshot): ModuleLifecyclePhase {
  const status = String(snapshot.status ?? '').toLowerCase()
  if (status === 'completed') {
    const warnings = Number(snapshot.warningCount ?? 0)
    const invalid = Number(snapshot.invalidRows ?? 0)
    const failed = Number(snapshot.failedCount ?? 0)
    return warnings > 0 || invalid > 0 || failed > 0 ? 'completed_with_warnings' : 'completed'
  }
  if (status === 'failed') return 'failed'
  if (status === 'cancelled') return 'cancelled'
  if (status === 'paused') return 'paused'
  if (status === 'pending') return 'queued'
  const startedWork = Number(snapshot.processedRows ?? 0) > 0 || Boolean(snapshot.currentStage)
  return startedWork ? 'processing' : 'claimed'
}

function maxNumber(...values: Array<number | null | undefined>): number {
  return values.reduce<number>((highest, value) => Math.max(highest, Number(value ?? 0)), 0)
}

function mergeProgress(current: ModuleProgressView | null, snapshot: PersistedImportJobSnapshot): ModuleProgressView {
  const processedRows = maxNumber(current?.processedRows, snapshot.processedRows, snapshot.progressSnapshot?.processedRecords)
  const totalRows = maxNumber(current?.totalRows, snapshot.totalRows, snapshot.progressSnapshot?.estimatedTotalRecords)
  return {
    processedRows,
    totalRows,
    importedCount: maxNumber(current?.importedCount, snapshot.importedCount),
    updatedCount: maxNumber(current?.updatedCount, snapshot.updatedCount),
    skippedCount: maxNumber(current?.skippedCount, snapshot.skippedCount),
    failedCount: maxNumber(current?.failedCount, snapshot.failedCount),
    progressPercent: maxNumber(current?.progressPercent, snapshot.progressPercent),
    currentStage: snapshot.currentStage ?? current?.currentStage ?? null,
    currentRecord: snapshot.currentRecord ?? current?.currentRecord ?? null,
    currentBatch: maxNumber(current?.currentBatch, snapshot.currentBatch),
    totalBatches: snapshot.totalBatches ?? current?.totalBatches ?? null,
    elapsedMs: maxNumber(current?.elapsedMs, snapshot.elapsedMs),
    throughput: snapshot.throughput ?? current?.throughput ?? null,
    averageThroughput: snapshot.averageThroughput ?? current?.averageThroughput ?? null,
    estimatedRemaining: snapshot.estimatedRemaining ?? current?.estimatedRemaining ?? null,
    estimatedRemainingSeconds: snapshot.estimatedRemainingSeconds ?? current?.estimatedRemainingSeconds ?? null,
    estimatedCompletionAt: snapshot.estimatedCompletionAt ?? current?.estimatedCompletionAt ?? null,
    activityEvents: snapshot.activityEvents ?? current?.activityEvents ?? [],
    progressSnapshot: snapshot.progressSnapshot ?? current?.progressSnapshot ?? {},
  }
}

/** Creates a permanent card for each selected resource, in dependency-run order. */
export function initializeModuleLifecycle(orderedSelection: SelectableResource[]): ModuleLifecycleState {
  const state: ModuleLifecycleState = {}
  orderedSelection.forEach((resource, index) => {
    state[resource.key] = {
      key: resource.key,
      moduleKey: resource.moduleKey,
      label: resource.label,
      order: index,
      phase: 'selected',
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
  })
  return withQueuePositions(state)
}

export function markModulesPreviewing(state: ModuleLifecycleState, keys?: string[]): ModuleLifecycleState {
  const target = keys ? new Set(keys) : null
  const next: ModuleLifecycleState = {}
  for (const [key, entry] of Object.entries(state)) {
    const shouldMark = (!target || target.has(key)) && !isTerminalPhase(entry.phase)
    next[key] = shouldMark ? { ...entry, phase: 'previewing', failure: null, unsupported: null } : entry
  }
  return withQueuePositions(next)
}

/**
 * Applies preview results. Any module that was previewing but is absent from the
 * response is recorded as a preview failure rather than dropped.
 */
export function applyPreviewResults(state: ModuleLifecycleState, previews: PreviewResultLike[]): ModuleLifecycleState {
  const next: ModuleLifecycleState = { ...state }
  const seen = new Set<string>()

  for (const preview of previews) {
    const entry = next[preview.key]
    if (!entry) continue
    seen.add(preview.key)
    if (preview.status === 'success') {
      next[preview.key] = {
        ...entry,
        phase: 'ready',
        estimate: estimateModuleWork(Number(preview.count ?? 0)),
        preview: {
          sampleRowCount: Array.isArray(preview.sampleRows) ? preview.sampleRows.length : 0,
          sampleErrorCount: Number(preview.validation?.errorCount ?? 0),
          countAccuracy: preview.countAccuracy ?? null,
        },
        failure: null,
        unsupported: null,
      }
      continue
    }
    if (preview.status === 'unsupported') {
      next[preview.key] = {
        ...entry,
        phase: 'unsupported',
        estimate: null,
        failure: null,
        unsupported: {
          message: preview.message ?? `${entry.label} is not supported by this source adapter.`,
          documentationUrl: preview.documentationUrl ?? null,
        },
      }
      continue
    }
    next[preview.key] = {
      ...entry,
      phase: 'preview_failed',
      estimate: null,
      unsupported: null,
      failure: {
        message: preview.message ?? 'Preview failed.',
        stage: preview.stage ?? null,
        errorCode: preview.errorCode ?? null,
        correlationId: preview.correlationId ?? null,
        retryable: !NON_RETRYABLE_PREVIEW_CODES.has(String(preview.errorCode ?? '')),
      },
    }
  }

  for (const [key, entry] of Object.entries(next)) {
    if (seen.has(key) || entry.phase !== 'previewing') continue
    next[key] = {
      ...entry,
      phase: 'preview_failed',
      failure: {
        message: 'The source returned no preview result for this module.',
        stage: 'preview_response',
        errorCode: 'PREVIEW_RESULT_MISSING',
        correlationId: null,
        retryable: true,
      },
    }
  }

  return withQueuePositions(next)
}

/** Records a whole-request preview failure without hiding any module. */
export function applyPreviewRequestFailure(state: ModuleLifecycleState, message: string, keys?: string[]): ModuleLifecycleState {
  const target = keys ? new Set(keys) : null
  const next: ModuleLifecycleState = {}
  for (const [key, entry] of Object.entries(state)) {
    const shouldMark = (!target || target.has(key)) && (entry.phase === 'previewing' || entry.phase === 'selected')
    next[key] = shouldMark
      ? {
        ...entry,
        phase: 'preview_failed',
        failure: { message, stage: 'request_received', errorCode: 'PREVIEW_REQUEST_FAILED', correlationId: null, retryable: true },
      }
      : entry
  }
  return withQueuePositions(next)
}

export function applyJobCreated(state: ModuleLifecycleState, key: string, jobId: string): ModuleLifecycleState {
  const entry = state[key]
  if (!entry) return state
  return withQueuePositions({ ...state, [key]: { ...entry, jobId, phase: 'queued' } })
}

/** Derives the module card entirely from the persisted import job row. */
export function applyJobSnapshot(state: ModuleLifecycleState, key: string, snapshot: PersistedImportJobSnapshot): ModuleLifecycleState {
  const entry = state[key]
  if (!entry) return state
  const incomingPhase = derivePhaseFromPersistedJob(snapshot)
  // A terminal persisted state can never be replaced by an older in-flight read.
  const phase = isTerminalPhase(entry.phase) && !isTerminalPhase(incomingPhase) ? entry.phase : incomingPhase
  return withQueuePositions({
    ...state,
    [key]: {
      ...entry,
      phase,
      progress: mergeProgress(entry.progress, snapshot),
      durationMs: snapshot.durationMs ?? entry.durationMs,
      warningCount: maxNumber(entry.warningCount, snapshot.warningCount, snapshot.invalidRows),
    },
  })
}

export function applyModuleFailure(state: ModuleLifecycleState, key: string, message: string): ModuleLifecycleState {
  const entry = state[key]
  if (!entry) return state
  if (isTerminalPhase(entry.phase)) return state
  return withQueuePositions({
    ...state,
    [key]: {
      ...entry,
      phase: 'failed',
      failure: { message, stage: null, errorCode: null, correlationId: null, retryable: false },
    },
  })
}

/** Marks modules that will not run because the migration stopped early. */
export function cancelPendingModules(state: ModuleLifecycleState, reason: string): ModuleLifecycleState {
  const next: ModuleLifecycleState = {}
  for (const [key, entry] of Object.entries(state)) {
    const isWaiting = entry.phase === 'queued' || entry.phase === 'ready'
    next[key] = isWaiting
      ? {
        ...entry,
        phase: 'cancelled',
        failure: { message: reason, stage: null, errorCode: null, correlationId: null, retryable: false },
      }
      : entry
  }
  return withQueuePositions(next)
}

export function withQueuePositions(state: ModuleLifecycleState): ModuleLifecycleState {
  const waiting = Object.values(state)
    .filter((entry) => entry.phase === 'queued')
    .sort((left, right) => left.order - right.order)
  const positions = new Map(waiting.map((entry, index) => [entry.key, index + 1]))
  const next: ModuleLifecycleState = {}
  for (const [key, entry] of Object.entries(state)) {
    const queuePosition = positions.get(key) ?? null
    next[key] = entry.queuePosition === queuePosition ? entry : { ...entry, queuePosition }
  }
  return next
}

export function orderedModules(state: ModuleLifecycleState): ModuleLifecycleEntry[] {
  return Object.values(state).sort((left, right) => left.order - right.order)
}

export function activeModule(state: ModuleLifecycleState): ModuleLifecycleEntry | null {
  return orderedModules(state).find((entry) => ['claimed', 'processing', 'paused'].includes(entry.phase)) ?? null
}

export function migrationHasStarted(state: ModuleLifecycleState): boolean {
  return Object.values(state).some((entry) => entry.jobId !== null)
}

export interface OverallMigrationProgress {
  percent: number
  total: number
  completed: number
  failed: number
  cancelled: number
  processing: number
  queued: number
  excluded: number
  importedCount: number
  updatedCount: number
  skippedCount: number
  failedCount: number
  processedRows: number
  totalRows: number
}

export function deriveOverallProgress(state: ModuleLifecycleState): OverallMigrationProgress {
  const entries = Object.values(state)
  const participating = entries.filter(participatesInMigration)
  const summary: OverallMigrationProgress = {
    percent: 0,
    total: participating.length,
    completed: 0,
    failed: 0,
    cancelled: 0,
    processing: 0,
    queued: 0,
    excluded: entries.length - participating.length,
    importedCount: 0,
    updatedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    processedRows: 0,
    totalRows: 0,
  }

  let percentAccumulator = 0
  for (const entry of participating) {
    if (entry.phase === 'completed' || entry.phase === 'completed_with_warnings') summary.completed += 1
    else if (entry.phase === 'failed') summary.failed += 1
    else if (entry.phase === 'cancelled') summary.cancelled += 1
    else if (entry.phase === 'processing' || entry.phase === 'claimed' || entry.phase === 'paused') summary.processing += 1
    else if (entry.phase === 'queued') summary.queued += 1

    percentAccumulator += isTerminalPhase(entry.phase) ? 100 : Math.min(100, entry.progress?.progressPercent ?? 0)

    summary.importedCount += entry.progress?.importedCount ?? 0
    summary.updatedCount += entry.progress?.updatedCount ?? 0
    summary.skippedCount += entry.progress?.skippedCount ?? 0
    summary.failedCount += entry.progress?.failedCount ?? 0
    summary.processedRows += entry.progress?.processedRows ?? 0
    summary.totalRows += entry.progress?.totalRows ?? entry.estimate?.records ?? 0
  }

  summary.percent = participating.length === 0
    ? 0
    : Math.min(100, Math.round((percentAccumulator / participating.length) * 100) / 100)
  return summary
}
