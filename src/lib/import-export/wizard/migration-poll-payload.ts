import type { MigrationActivityEvent } from '../types'
import type {
  HydratedMigrationSession,
  MigrationSessionRecord,
  MigrationSessionState,
  MigrationSessionStatus,
  MigrationSessionStep,
  QuickBooksMigrationSessionConfig,
} from './migration-session'
import { restoreLifecycleFromSession } from './migration-session'
import type { PersistedImportJobSnapshot } from './module-lifecycle'
import type {
  MigrationQueueHealth,
  MigrationQueueHealthThresholds,
  PersistedQueueJobSnapshot,
} from './migration-queue-health'

/**
 * Compact polling envelope.
 *
 * Static session metadata is sent once. Subsequent polls send only live progress,
 * queue health, and activity-event deltas. The client merges into a full
 * HydratedMigrationSession so UI behavior stays unchanged.
 */
export type MigrationActivityCursors = Record<string, string>

export interface MigrationSessionStaticPayload {
  id: string
  companyId: string
  userId: string | null
  createdAt: string
  config: QuickBooksMigrationSessionConfig
}

/** Live job progress without activityEvents (those travel as deltas). */
export type CompactJobProgress = Omit<
  PersistedImportJobSnapshot & { id: string; moduleKey: string },
  'activityEvents'
> & { activityTailId: string | null }

export interface MigrationSessionLivePayload {
  id: string
  updatedAt: string
  step: MigrationSessionStep
  status: MigrationSessionStatus
  state: MigrationSessionState
  jobs: Record<string, CompactJobProgress>
  activityDeltas: Record<string, MigrationActivityEvent[]>
  activityCursors: MigrationActivityCursors
  queueJobs: Record<string, PersistedQueueJobSnapshot>
  queueHealth: Record<string, MigrationQueueHealth>
  queueHealthThresholds?: MigrationQueueHealthThresholds
}

export interface MigrationPollEnvelope {
  kind: 'full' | 'delta' | 'noop'
  static?: MigrationSessionStaticPayload
  live?: MigrationSessionLivePayload
}

export function activityTailId(events: MigrationActivityEvent[] | undefined): string | null {
  if (!events || events.length === 0) return null
  return events[events.length - 1]?.id ?? null
}

export function sliceActivityDelta(
  events: MigrationActivityEvent[] | undefined,
  afterId: string | undefined,
): MigrationActivityEvent[] {
  if (!events || events.length === 0) return []
  if (!afterId) return events
  const index = events.findIndex((event) => event.id === afterId)
  if (index < 0) return events
  return events.slice(index + 1)
}

export function mergeActivityEvents(
  previous: MigrationActivityEvent[] | undefined,
  delta: MigrationActivityEvent[] | undefined,
): MigrationActivityEvent[] {
  if (!delta || delta.length === 0) return previous ?? []
  if (!previous || previous.length === 0) return delta
  const seen = new Set(previous.map((event) => event.id))
  const merged = [...previous]
  for (const event of delta) {
    if (seen.has(event.id)) continue
    seen.add(event.id)
    merged.push(event)
  }
  return merged
}

function compactJob(
  job: PersistedImportJobSnapshot & { id: string; moduleKey: string },
): CompactJobProgress {
  const { activityEvents, ...rest } = job
  return {
    ...rest,
    activityTailId: activityTailId(activityEvents),
  }
}

function liveFingerprint(live: MigrationSessionLivePayload): string {
  return JSON.stringify({
    id: live.id,
    updatedAt: live.updatedAt,
    step: live.step,
    status: live.status,
    state: live.state,
    jobs: live.jobs,
    activityCursors: live.activityCursors,
    queueJobs: live.queueJobs,
    queueHealth: live.queueHealth,
  })
}

export function migrationLivePayloadFingerprint(live: MigrationSessionLivePayload): string {
  return liveFingerprint(live)
}

/**
 * Projects a hydrated session into a poll envelope.
 * - full: includes static metadata + all activity events as deltas
 * - delta: omits static metadata; activityEvents only include new ids after cursors
 * - noop: nothing meaningful changed since the prior live fingerprint
 */
export function projectMigrationPollPayload(
  session: HydratedMigrationSession,
  options?: {
    includeStatic?: boolean
    activityCursors?: MigrationActivityCursors
    previousLiveFingerprint?: string | null
  },
): MigrationPollEnvelope {
  const includeStatic = options?.includeStatic ?? true
  const cursors = options?.activityCursors ?? {}
  const jobs: MigrationSessionLivePayload['jobs'] = {}
  const activityDeltas: Record<string, MigrationActivityEvent[]> = {}
  const activityCursors: MigrationActivityCursors = {}

  for (const [key, job] of Object.entries(session.jobs)) {
    const events = job.activityEvents ?? []
    const delta = sliceActivityDelta(events, cursors[key])
    jobs[key] = compactJob(job)
    if (delta.length > 0) activityDeltas[key] = delta
    const tail = activityTailId(events)
    if (tail) activityCursors[key] = tail
  }

  const live: MigrationSessionLivePayload = {
    id: session.id,
    updatedAt: session.updatedAt,
    step: session.step,
    status: session.status,
    state: session.config.state,
    jobs,
    activityDeltas,
    activityCursors,
    queueJobs: session.queueJobs ?? {},
    queueHealth: session.queueHealth ?? {},
    queueHealthThresholds: session.queueHealthThresholds,
  }

  const fingerprint = liveFingerprint(live)
  if (
    !includeStatic
    && options?.previousLiveFingerprint
    && options.previousLiveFingerprint === fingerprint
    && Object.keys(activityDeltas).length === 0
  ) {
    return { kind: 'noop' }
  }

  if (includeStatic) {
    return {
      kind: 'full',
      static: {
        id: session.id,
        companyId: session.companyId,
        userId: session.userId,
        createdAt: session.createdAt,
        config: session.config,
      },
      live,
    }
  }

  return { kind: 'delta', live }
}

export function extractActivityCursors(session: HydratedMigrationSession | null): MigrationActivityCursors {
  if (!session) return {}
  const cursors: MigrationActivityCursors = {}
  for (const [key, job] of Object.entries(session.jobs)) {
    const tail = activityTailId(job.activityEvents)
      ?? activityTailId(session.lifecycle[key]?.progress?.activityEvents)
    if (tail) cursors[key] = tail
  }
  return cursors
}

/**
 * Rebuilds the full hydrated session consumers already understand.
 * Static metadata comes from the envelope (full) or the previous session (delta).
 * Activity events accumulate from prior state + deltas so none are lost.
 */
export function mergeMigrationPollPayload(
  previous: HydratedMigrationSession | null,
  envelope: MigrationPollEnvelope,
): HydratedMigrationSession | null {
  if (envelope.kind === 'noop') return previous

  const staticPayload = envelope.static ?? (previous
    ? {
      id: previous.id,
      companyId: previous.companyId,
      userId: previous.userId,
      createdAt: previous.createdAt,
      config: previous.config,
    }
    : null)
  const live = envelope.live
  if (!staticPayload || !live) return previous

  const jobs: HydratedMigrationSession['jobs'] = {}
  for (const [key, compact] of Object.entries(live.jobs)) {
    const jobRest = { ...compact }
    delete (jobRest as { activityTailId?: string | null }).activityTailId
    const previousEvents = previous?.jobs[key]?.activityEvents
      ?? previous?.lifecycle[key]?.progress?.activityEvents
    jobs[key] = {
      ...jobRest,
      activityEvents: mergeActivityEvents(previousEvents, live.activityDeltas[key]),
    }
  }

  // Preserve any previously known job that vanished from a transient poll.
  if (previous) {
    for (const [key, job] of Object.entries(previous.jobs)) {
      if (!jobs[key]) jobs[key] = job
    }
  }

  const config: QuickBooksMigrationSessionConfig = {
    ...staticPayload.config,
    state: live.state,
  }
  const record: MigrationSessionRecord = {
    id: staticPayload.id,
    companyId: staticPayload.companyId,
    userId: staticPayload.userId,
    step: live.step,
    status: live.status,
    config,
    createdAt: staticPayload.createdAt,
    updatedAt: live.updatedAt,
  }

  return {
    ...record,
    jobs,
    queueJobs: live.queueJobs,
    queueHealth: live.queueHealth,
    queueHealthThresholds: live.queueHealthThresholds ?? previous?.queueHealthThresholds,
    lifecycle: restoreLifecycleFromSession(config, jobs),
  }
}

export function migrationPollLiveFingerprint(session: HydratedMigrationSession | null): string | null {
  if (!session) return null
  const projected = projectMigrationPollPayload(session, { includeStatic: false })
  return projected.live ? liveFingerprint(projected.live) : null
}

/** UTF-8 byte length of a JSON value — used by size regression tests. */
export function utf8JsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8')
}
