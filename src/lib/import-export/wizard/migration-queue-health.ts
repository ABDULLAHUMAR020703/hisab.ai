export type MigrationExecutionState =
  | 'queued'
  | 'worker_claimed'
  | 'processing'
  | 'paused'
  | 'completed'
  | 'failed'

export type MigrationWorkerWarning = 'not_running' | 'offline' | null

export interface PersistedQueueJobSnapshot {
  id: string
  importJobId: string
  status: string
  scheduledAt: string
  startedAt: string | null
  completedAt: string | null
  createdAt: string
  updatedAt: string
  attempts: number
  maxAttempts: number
  lastError: string | null
}

export interface QueueImportJobSnapshot {
  status: string
  createdAt?: string | null
  updatedAt?: string | null
  startedAt?: string | null
  pausedAt?: string | null
  lastHeartbeatAt?: string | null
  processedRows?: number
}

export interface MigrationQueueHealth {
  state: MigrationExecutionState
  label: string
  warning: MigrationWorkerWarning
  warningMessage: string | null
  waitingSince: string | null
  waitingMs: number
  lastQueueUpdateAt: string | null
  workerClaimedAt: string | null
  lastHeartbeatAt: string | null
  suggestedAction: string | null
  retryAppropriate: boolean
}

export interface MigrationQueueHealthThresholds {
  queueStallThresholdMs: number
  heartbeatTimeoutMs: number
}

const EXECUTION_LABEL: Record<MigrationExecutionState, string> = {
  queued: 'Queued',
  worker_claimed: 'Worker Claimed',
  processing: 'Processing',
  paused: 'Paused',
  completed: 'Completed',
  failed: 'Failed',
}

function timestamp(value: string | null | undefined): number | null {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function latestTimestamp(...values: Array<string | null | undefined>): string | null {
  let latest: { value: string; time: number } | null = null
  for (const value of values) {
    const time = timestamp(value)
    if (value && time !== null && (!latest || time > latest.time)) latest = { value, time }
  }
  return latest?.value ?? null
}

function elapsed(now: number, value: string | null | undefined): number {
  const time = timestamp(value)
  return time === null ? 0 : Math.max(0, now - time)
}

/**
 * Derives queue/worker health exclusively from persisted import_jobs and
 * job_queue evidence. It never claims, retries, or mutates queue ownership.
 */
export function detectMigrationQueueHealth(input: {
  importJob: QueueImportJobSnapshot
  queueJob: PersistedQueueJobSnapshot | null
  now?: number
  thresholds: MigrationQueueHealthThresholds
}): MigrationQueueHealth {
  const now = input.now ?? Date.now()
  const importStatus = String(input.importJob.status ?? '').toLowerCase()
  const queueStatus = String(input.queueJob?.status ?? '').toUpperCase()
  const lastHeartbeatAt = latestTimestamp(
    input.importJob.lastHeartbeatAt,
    queueStatus === 'RUNNING' ? input.queueJob?.updatedAt : null,
    input.importJob.updatedAt,
  )
  const waitingSince = input.queueJob?.scheduledAt
    ?? input.queueJob?.createdAt
    ?? input.importJob.updatedAt
    ?? input.importJob.createdAt
    ?? null
  const lastQueueUpdateAt = input.queueJob?.updatedAt ?? input.importJob.updatedAt ?? null

  let state: MigrationExecutionState = 'queued'
  if (importStatus === 'completed') state = 'completed'
  else if (
    importStatus === 'failed'
    || importStatus === 'cancelled'
    || queueStatus === 'FAILED'
    || queueStatus === 'DEAD'
    || queueStatus === 'CANCELLED'
  ) state = 'failed'
  else if (importStatus === 'paused') state = 'paused'
  else if (queueStatus === 'RUNNING') {
    state = importStatus === 'pending' && Number(input.importJob.processedRows ?? 0) === 0
      ? 'worker_claimed'
      : 'processing'
  } else if (queueStatus === 'PENDING') {
    state = 'queued'
  } else if (importStatus === 'processing') {
    state = 'processing'
  }

  let warning: MigrationWorkerWarning = null
  let warningMessage: string | null = null
  let suggestedAction: string | null = null
  if (state === 'queued' && elapsed(now, waitingSince) > input.thresholds.queueStallThresholdMs) {
    warning = 'not_running'
    warningMessage = 'No background worker has claimed this migration.'
    suggestedAction = 'Start or verify the background worker, then wait for the next status update.'
  } else if (
    (state === 'worker_claimed' || state === 'processing')
    && elapsed(now, lastHeartbeatAt) > input.thresholds.heartbeatTimeoutMs
  ) {
    warning = 'offline'
    warningMessage = 'Background worker appears offline.'
    suggestedAction = 'Check the worker process and queue connectivity. Progress will resume from its persisted checkpoint after recovery.'
  }

  return {
    state,
    label: EXECUTION_LABEL[state],
    warning,
    warningMessage,
    waitingSince: state === 'queued' ? waitingSince : warning === 'offline' ? lastHeartbeatAt : null,
    waitingMs: state === 'queued'
      ? elapsed(now, waitingSince)
      : warning === 'offline'
        ? elapsed(now, lastHeartbeatAt)
        : 0,
    lastQueueUpdateAt,
    workerClaimedAt: input.queueJob?.startedAt ?? null,
    lastHeartbeatAt,
    suggestedAction,
    retryAppropriate: state === 'failed' && importStatus === 'failed',
  }
}
