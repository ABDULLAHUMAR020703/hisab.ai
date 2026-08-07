import { orderedModules, type ModuleLifecycleEntry, type ModuleLifecyclePhase } from './module-lifecycle'
import type { HydratedMigrationSession } from './migration-session'

const EXCLUDED_PHASES = new Set<ModuleLifecyclePhase>(['unsupported', 'preview_failed'])
const COMPLETED_PHASES = new Set<ModuleLifecyclePhase>(['completed', 'completed_with_warnings'])
const FAILED_PHASES = new Set<ModuleLifecyclePhase>(['failed', 'cancelled'])

export type CoordinationAction =
  | { type: 'idle'; key: null }
  | { type: 'mark-failed'; key: string }
  | { type: 'mark-completed'; key: string }
  | { type: 'create-job'; key: string; module: ModuleLifecycleEntry }
  | { type: 'run-job'; key: string; module: ModuleLifecycleEntry }

const IDLE: CoordinationAction = { type: 'idle', key: null }

/**
 * Fingerprint of the only session facts coordination reacts to: session identity,
 * session state, and each module's phase, job id, and persisted job status.
 *
 * Two distinct session objects carrying identical persisted content produce the
 * same fingerprint, so a poll that changes nothing can never start another
 * coordination cycle. Coordination therefore advances on real lifecycle events
 * (session created, module completed, module failed, retry, resume) instead of
 * on React object identity.
 */
export function coordinationFingerprint(session: HydratedMigrationSession | null): string {
  if (!session) return ''
  const modules = orderedModules(session.lifecycle)
    .map((entry) => [
      entry.key,
      entry.phase,
      entry.jobId ?? '-',
      session.jobs[entry.key]?.status ?? '-',
    ].join('~'))
    .join('|')
  return `${session.id}#${session.config.state}#${modules}`
}

/**
 * Decides the single next coordination side effect for a session. `issued` holds
 * the action keys already dispatched for this session, so a repeated evaluation
 * of the same persisted state resolves to `idle` instead of re-posting an import
 * or a queue run. Queue, worker, and job semantics are unchanged: this only
 * decides whether the provider should act.
 */
export function nextCoordinationAction(
  session: HydratedMigrationSession,
  issued: ReadonlySet<string>,
): CoordinationAction {
  if (session.config.state !== 'running') return IDLE

  const participating = orderedModules(session.lifecycle)
    .filter((entry) => !EXCLUDED_PHASES.has(entry.phase))

  const failed = participating.find((entry) => FAILED_PHASES.has(entry.phase))
  if (failed) return guard({ type: 'mark-failed', key: `${session.id}:state:failed` }, issued)

  const unfinished = participating.find((entry) => !COMPLETED_PHASES.has(entry.phase))
  if (!unfinished) return guard({ type: 'mark-completed', key: `${session.id}:state:completed` }, issued)

  if (!unfinished.jobId) {
    return guard({ type: 'create-job', key: `${session.id}:create:${unfinished.key}`, module: unfinished }, issued)
  }

  const job = session.jobs[unfinished.key]
  if (!job || job.status === 'pending') {
    return guard({ type: 'run-job', key: `${session.id}:run:${unfinished.jobId}`, module: unfinished }, issued)
  }

  return IDLE
}

/** A create-job dispatch must never be replayed: the import may already exist. */
export function isReplayableCoordinationAction(action: CoordinationAction): boolean {
  return action.type === 'mark-failed' || action.type === 'mark-completed' || action.type === 'run-job'
}

function guard(action: CoordinationAction, issued: ReadonlySet<string>): CoordinationAction {
  return action.key && issued.has(action.key) ? IDLE : action
}
