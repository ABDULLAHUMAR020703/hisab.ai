import type { MigrationProgressSnapshot } from '../types'

export type ProgressCountPatch = {
  importedCount?: number
  updatedCount?: number
  skippedCount?: number
  failedCount?: number
  validRows?: number
  invalidRows?: number
  warningCount?: number
}

export type PersistedProgressState = {
  status: string
  processedRows: number
  totalRows: number
  importedCount: number
  updatedCount: number
  skippedCount: number
  failedCount: number
  validRows: number | null
  invalidRows: number | null
  warningCount: number | null
  progressSnapshot: MigrationProgressSnapshot | null
}

export type MergedProgressState = {
  processedRows: number
  totalRows: number
  importedCount: number
  updatedCount: number
  skippedCount: number
  failedCount: number
  validRows: number | null
  invalidRows: number | null
  warningCount: number | null
  progressSnapshot: MigrationProgressSnapshot
  progressPercent: number
}

type SnapshotWithPercent = MigrationProgressSnapshot & { progressPercent?: number }

function maxNumber(...values: Array<number | null | undefined>): number {
  return values.reduce<number>((highest, value) => Math.max(highest, Number(value ?? 0)), 0)
}

function maxNullable(left: number | null | undefined, right: number | null | undefined): number | null {
  if (left === null || left === undefined) return right === undefined ? null : right
  if (right === null || right === undefined) return left
  return Math.max(left, right)
}

export function computeProgressPercent(processedRows: number, totalRows: number, previousPercent = 0): number {
  if (totalRows <= 0) return Math.max(0, previousPercent)
  const next = Math.min(100, Math.round((processedRows / totalRows) * 10000) / 100)
  return Math.max(previousPercent, next)
}

export function mergeProgressSnapshot(
  current: MigrationProgressSnapshot | null | undefined,
  incoming: MigrationProgressSnapshot | null | undefined,
  totals: {
    processedRows: number
    totalRows: number
    importedCount: number
    updatedCount: number
    skippedCount: number
    failedCount: number
    progressPercent: number
  },
): MigrationProgressSnapshot {
  const prior = current ?? {}
  const next = incoming ?? {}
  return {
    ...prior,
    ...next,
    currentModule: next.currentModule ?? prior.currentModule ?? null,
    currentStage: next.currentStage ?? prior.currentStage ?? null,
    currentRecord: next.currentRecord ?? prior.currentRecord ?? null,
    currentBatch: maxNumber(prior.currentBatch, next.currentBatch) || null,
    totalBatches: maxNullable(prior.totalBatches, next.totalBatches),
    estimatedTotalRecords: maxNumber(prior.estimatedTotalRecords, next.estimatedTotalRecords, totals.totalRows),
    processedRecords: maxNumber(prior.processedRecords, next.processedRecords, totals.processedRows),
    importedCount: maxNumber(prior.importedCount, next.importedCount, totals.importedCount),
    updatedCount: maxNumber(prior.updatedCount, next.updatedCount, totals.updatedCount),
    skippedCount: maxNumber(prior.skippedCount, next.skippedCount, totals.skippedCount),
    failedCount: maxNumber(prior.failedCount, next.failedCount, totals.failedCount),
    apiRequests: maxNumber(prior.apiRequests, next.apiRequests),
    databaseQueries: maxNumber(prior.databaseQueries, next.databaseQueries),
    databaseWrites: maxNumber(prior.databaseWrites, next.databaseWrites),
    databaseTimeMs: maxNumber(prior.databaseTimeMs, next.databaseTimeMs),
    apiTimeMs: maxNumber(prior.apiTimeMs, next.apiTimeMs),
    retryCount: maxNumber(prior.retryCount, next.retryCount),
    throughput: next.throughput ?? prior.throughput ?? null,
    averageThroughput: next.averageThroughput ?? prior.averageThroughput ?? null,
    memoryBytes: next.memoryBytes ?? prior.memoryBytes ?? null,
    startedAt: prior.startedAt ?? next.startedAt ?? null,
    activeProcessingMs: maxNumber(prior.activeProcessingMs, next.activeProcessingMs) || undefined,
    stages: { ...(prior.stages ?? {}), ...(next.stages ?? {}) },
    progressPercent: totals.progressPercent,
  }
}

/** Merges an incoming progress write with the latest persisted job state. Never decreases counters. */
export function mergeImportJobProgress(
  current: PersistedProgressState,
  incoming: {
    processedRows: number
    totalRows?: number
    counts?: ProgressCountPatch
    progressSnapshot?: MigrationProgressSnapshot
  },
): MergedProgressState | 'stale_completed' {
  if (current.status === 'completed') return 'stale_completed'

  const importedCount = maxNumber(current.importedCount, incoming.counts?.importedCount)
  const updatedCount = maxNumber(current.updatedCount, incoming.counts?.updatedCount)
  const skippedCount = maxNumber(current.skippedCount, incoming.counts?.skippedCount)
  const failedCount = maxNumber(current.failedCount, incoming.counts?.failedCount)
  const outcomeRows = importedCount + updatedCount + skippedCount + failedCount
  const processedRows = maxNumber(
    current.processedRows,
    incoming.processedRows,
    incoming.progressSnapshot?.processedRecords,
    outcomeRows,
  )
  const totalRows = maxNumber(current.totalRows, incoming.totalRows, incoming.progressSnapshot?.estimatedTotalRecords, processedRows)
  const previousPercent = Number((current.progressSnapshot as SnapshotWithPercent | null)?.progressPercent ?? 0)
  const progressPercent = computeProgressPercent(processedRows, totalRows, previousPercent)
  const progressSnapshot = mergeProgressSnapshot(current.progressSnapshot, incoming.progressSnapshot, {
    processedRows,
    totalRows,
    importedCount,
    updatedCount,
    skippedCount,
    failedCount,
    progressPercent,
  })

  return {
    processedRows,
    totalRows,
    importedCount,
    updatedCount,
    skippedCount,
    failedCount,
    validRows: maxNullable(current.validRows, incoming.counts?.validRows),
    invalidRows: maxNullable(current.invalidRows, incoming.counts?.invalidRows),
    warningCount: maxNullable(current.warningCount, incoming.counts?.warningCount),
    progressSnapshot,
    progressPercent,
  }
}

export function finalizeProgressSnapshot(
  current: MigrationProgressSnapshot | null | undefined,
  input: {
    status: string
    processedRows: number
    totalRows: number
    importedCount: number
    updatedCount: number
    skippedCount: number
    failedCount: number
    failure?: MigrationProgressSnapshot['failure']
  },
): MigrationProgressSnapshot {
  const progressPercent = input.status === 'completed' ? 100 : computeProgressPercent(input.processedRows, input.totalRows)
  const merged = mergeProgressSnapshot(current, {
    processedRecords: input.processedRows,
    estimatedTotalRecords: input.totalRows,
    importedCount: input.importedCount,
    updatedCount: input.updatedCount,
    skippedCount: input.skippedCount,
    failedCount: input.failedCount,
    currentStage: input.status === 'completed'
      ? 'report_generation'
      : input.failure?.stage ?? current?.currentStage ?? null,
    progressPercent,
  }, {
    processedRows: input.processedRows,
    totalRows: input.totalRows,
    importedCount: input.importedCount,
    updatedCount: input.updatedCount,
    skippedCount: input.skippedCount,
    failedCount: input.failedCount,
    progressPercent,
  })
  if (input.failure) return { ...merged, failure: input.failure }
  return merged
}
