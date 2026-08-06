import { orderedModules, type ModuleLifecyclePhase } from './module-lifecycle'
import type { HydratedMigrationSession, MigrationSessionState } from './migration-session'

const EXCLUDED_PHASES = new Set<ModuleLifecyclePhase>(['unsupported', 'preview_failed'])
const COMPLETED_PHASES = new Set<ModuleLifecyclePhase>(['completed', 'completed_with_warnings'])
const TERMINAL_PHASES = new Set<ModuleLifecyclePhase>([
  'completed',
  'completed_with_warnings',
  'failed',
  'cancelled',
])

/** Import job states that mean work is still owned by a worker or by the user. */
const ACTIVE_JOB_STATUSES = new Set(['processing', 'paused'])

export const DEFAULT_MIGRATION_SESSION_STALE_MS = 15 * 60_000

export type MigrationSessionReconcileReason =
  | 'all_modules_completed'
  | 'module_terminal_failure'
  | 'abandoned'

export interface MigrationSessionReconcileResolution {
  state: Extract<MigrationSessionState, 'completed' | 'failed'>
  reason: MigrationSessionReconcileReason
  /** Mirrors the step the wizard writes for the same transition. */
  step: 'report' | 'import'
}

export interface MigrationSessionActivity {
  activeQueueJobs: number
  activeImportJobs: number
  /** Newest persisted signal of real work: session write or import job write. */
  lastActivityAt: string | null
}

/**
 * Collects the persisted "is anything still working" facts for a session. Only
 * PENDING/RUNNING queue rows are hydrated onto the session, so their presence is
 * enough to prove the queue still owns this migration.
 */
export function collectMigrationSessionActivity(
  session: HydratedMigrationSession,
  options: { ignoreQueueJobIds?: readonly string[] } = {},
): MigrationSessionActivity {
  const ignored = new Set(options.ignoreQueueJobIds ?? [])
  const jobs = Object.values(session.jobs)
  let lastActivity = Date.parse(session.updatedAt)
  for (const job of jobs) {
    for (const stamp of [job.updatedAt, job.lastHeartbeatAt]) {
      const parsed = stamp ? Date.parse(stamp) : NaN
      if (Number.isFinite(parsed) && parsed > lastActivity) lastActivity = parsed
    }
  }
  return {
    activeQueueJobs: Object.values(session.queueJobs ?? {}).filter((queueJob) => !ignored.has(queueJob.id)).length,
    activeImportJobs: jobs.filter((job) => ACTIVE_JOB_STATUSES.has(job.status)).length,
    lastActivityAt: Number.isFinite(lastActivity) ? new Date(lastActivity).toISOString() : null,
  }
}

/**
 * Decides whether a running session must be closed, using persisted state only.
 *
 * A session stays open while the queue or a worker still owns any of its jobs.
 * Once nothing is running it is either finished (every participating module is
 * terminal) or abandoned — a chain that stopped advancing because the browser
 * that was driving it went away. Both must leave IN_PROGRESS.
 */
export function resolveMigrationSessionReconciliation(
  session: HydratedMigrationSession,
  activity: MigrationSessionActivity,
  options: { now?: number; stalledAfterMs?: number } = {},
): MigrationSessionReconcileResolution | null {
  if (session.config.state !== 'running') return null
  if (activity.activeQueueJobs > 0 || activity.activeImportJobs > 0) return null

  const participating = orderedModules(session.lifecycle)
    .filter((entry) => !EXCLUDED_PHASES.has(entry.phase))

  if (participating.length > 0 && participating.every((entry) => COMPLETED_PHASES.has(entry.phase))) {
    return { state: 'completed', reason: 'all_modules_completed', step: 'report' }
  }

  if (participating.length > 0 && participating.every((entry) => TERMINAL_PHASES.has(entry.phase))) {
    return { state: 'failed', reason: 'module_terminal_failure', step: 'import' }
  }

  const stalledAfterMs = options.stalledAfterMs ?? DEFAULT_MIGRATION_SESSION_STALE_MS
  const now = options.now ?? Date.now()
  const lastActivity = activity.lastActivityAt ? Date.parse(activity.lastActivityAt) : NaN
  if (!Number.isFinite(lastActivity)) return null
  if (now - lastActivity < stalledAfterMs) return null

  return { state: 'failed', reason: 'abandoned', step: 'import' }
}
