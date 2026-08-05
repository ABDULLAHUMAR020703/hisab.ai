import {
  cancelPendingModules,
  orderedModules,
  withQueuePositions,
  type ModuleLifecycleEntry,
  type ModuleLifecyclePhase,
  type ModuleLifecycleState,
} from './module-lifecycle'
import type { MigrationSessionState } from './migration-session'

/** Shown in confirmation dialogs and stored on cancelled module cards. */
export const MIGRATION_CANCEL_CONFIRMATION =
  'The current module will finish its active batch before stopping. Completed modules will remain available.'

const TERMINAL_JOB_STATUSES = new Set(['completed', 'failed', 'cancelled'])
const ACTIVE_JOB_STATUSES = new Set(['processing'])
const ACTIVE_PHASES = new Set<ModuleLifecyclePhase>(['processing', 'claimed'])

export function canCancelMigrationSession(state: MigrationSessionState): boolean {
  return state === 'running'
}

export function isActivelyRunningModule(
  entry: Pick<ModuleLifecycleEntry, 'phase'>,
  jobStatus?: string | null,
): boolean {
  const status = String(jobStatus ?? '').toLowerCase()
  if (ACTIVE_JOB_STATUSES.has(status)) return true
  if (ACTIVE_PHASES.has(entry.phase) && !TERMINAL_JOB_STATUSES.has(status)) return true
  return false
}

export interface GracefulCancelPlan {
  lifecycle: ModuleLifecycleState
  /** Import jobs that never started (or are only queued) — safe to finalize as cancelled now. */
  cancelJobIds: string[]
  /** Import jobs mid-batch — leave running until the current checkpoint finishes. */
  preserveJobIds: string[]
}

/**
 * Plans a graceful migration cancel: mark not-started modules cancelled, cancel their
 * import jobs, and leave the active processing job alone so its current batch can finish.
 */
export function planGracefulMigrationCancel(
  lifecycle: ModuleLifecycleState,
  jobs: Record<string, { id: string; status: string }>,
  reason: string = MIGRATION_CANCEL_CONFIRMATION,
): GracefulCancelPlan {
  const nextLifecycle = cancelPendingModules(lifecycle, reason)
  const cancelJobIds: string[] = []
  const preserveJobIds: string[] = []

  for (const entry of orderedModules(lifecycle)) {
    const jobId = entry.jobId
    if (!jobId) continue
    const job = jobs[entry.key]
      ?? Object.values(jobs).find((candidate) => candidate.id === jobId)
    const status = String(job?.status ?? '').toLowerCase()
    if (TERMINAL_JOB_STATUSES.has(status)) continue

    if (isActivelyRunningModule(entry, status)) {
      preserveJobIds.push(jobId)
    } else {
      cancelJobIds.push(jobId)
    }
  }

  return { lifecycle: nextLifecycle, cancelJobIds, preserveJobIds }
}

/**
 * Re-queues cancelled modules so a cancelled session can resume without losing
 * completed modules or progress snapshots on partially imported jobs.
 */
export function planResumeAfterCancellation(lifecycle: ModuleLifecycleState): ModuleLifecycleState {
  const next: ModuleLifecycleState = {}
  for (const [key, entry] of Object.entries(lifecycle)) {
    if (entry.phase !== 'cancelled') {
      next[key] = entry
      continue
    }
    next[key] = {
      ...entry,
      phase: entry.jobId ? 'queued' : 'ready',
      failure: null,
    }
  }
  return withQueuePositions(next)
}

export function migrationCancelConfirmMessage(): string {
  return `Cancel Migration?\n\n${MIGRATION_CANCEL_CONFIRMATION}`
}
