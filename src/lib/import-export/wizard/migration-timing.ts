import type { HydratedMigrationSession } from './migration-session'
import {
  orderedModules,
  type ModuleLifecycleEntry,
  type ModuleLifecyclePhase,
} from './module-lifecycle'

export const ETA_ESTIMATING_LABEL = 'Estimating...'

/** Minimum completed records before ETA is considered trustworthy. */
export const MIN_COMPLETED_RECORDS_FOR_ETA = 1
/** Minimum active processing history before ETA is considered trustworthy. */
export const MIN_ACTIVE_MS_FOR_ETA = 1_000
/** Gaps at or above this threshold appear in the restore/execution waterfall. */
export const WATERFALL_GAP_THRESHOLD_MS = 100

const COMPLETED_PHASES = new Set<ModuleLifecyclePhase>(['completed', 'completed_with_warnings'])
const ACTIVE_PHASES = new Set<ModuleLifecyclePhase>(['processing', 'claimed'])

export type MigrationTimingWaterfallKind =
  | 'session'
  | 'queue_wait'
  | 'worker'
  | 'stage'
  | 'idle_gap'
  | 'orchestration'

export interface MigrationTimingWaterfallEntry {
  id: string
  label: string
  moduleKey: string | null
  kind: MigrationTimingWaterfallKind
  startedAt: string
  endedAt: string
  durationMs: number
}

export interface MigrationTimingSnapshot {
  startedAt: string
  completedAt: string | null
  /** Wall-clock time since migration start (includes queue/pause/orchestration idle). */
  elapsedMs: number
  /** Time spent inside claimed worker steps only. */
  activeProcessingMs: number
  /** Time jobs sat pending/queued before a worker claimed them. */
  queueWaitMs: number
  /**
   * Non-active wall time that is not attributed to measured queue wait
   * (orchestration gaps, post-finish hang, abandoned-tab reconcile lag, etc.).
   */
  idleMs: number
  /** Cumulative Supabase/DB await time recorded inside worker traces. */
  databaseTimeMs: number
  /** Cumulative QuickBooks API await time recorded inside worker traces. */
  apiTimeMs: number
  /** Completed-module throughput in records/second, or null when insufficient history. */
  completedThroughput: number | null
  remainingRecords: number
  remainingMs: number | null
  etaLabel: string
  /** Chronological spans + idle gaps ≥ WATERFALL_GAP_THRESHOLD_MS. */
  waterfall: MigrationTimingWaterfallEntry[]
}

function parseInstant(value: string | null | undefined): number | null {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function moduleRecords(entry: ModuleLifecycleEntry): number {
  return Math.max(
    0,
    entry.progress?.totalRows
      ?? entry.estimate?.records
      ?? 0,
  )
}

function moduleProcessed(entry: ModuleLifecycleEntry): number {
  return Math.max(0, entry.progress?.processedRows ?? 0)
}

function moduleActiveMs(entry: ModuleLifecycleEntry, nowMs: number): number {
  const snapshotActive = Number(entry.progress?.progressSnapshot?.activeProcessingMs ?? 0)
  if (snapshotActive > 0) return snapshotActive

  if (COMPLETED_PHASES.has(entry.phase) || entry.phase === 'failed' || entry.phase === 'cancelled') {
    return Math.max(0, entry.durationMs ?? entry.progress?.elapsedMs ?? 0)
  }

  if (!ACTIVE_PHASES.has(entry.phase)) return 0

  // Live step without a persisted active timer yet: count only since the latest
  // heartbeat/resume, never since session start (that would include queue idle).
  const liveAnchor = parseInstant(entry.progress?.progressSnapshot?.startedAt)
    ?? parseInstant(entry.progress?.activityEvents.at(-1)?.at ?? null)
  if (liveAnchor == null) return 0
  return Math.max(0, nowMs - liveAnchor)
}

function moduleQueueWaitMs(
  entry: ModuleLifecycleEntry,
  session: HydratedMigrationSession,
  nowMs: number,
): number {
  const job = session.jobs[entry.key]
    ?? Object.values(session.jobs).find((candidate) => candidate.id === entry.jobId)
  const queueJob = entry.jobId
    ? Object.values(session.queueJobs ?? {}).find((row) => row.importJobId === entry.jobId)
    : null

  const queuedAt = parseInstant(job?.createdAt)
    ?? parseInstant(queueJob?.createdAt)
    ?? parseInstant(queueJob?.scheduledAt)
  if (queuedAt == null) return 0

  const claimedAt = parseInstant(job?.startedAt)
    ?? parseInstant(queueJob?.startedAt)
    ?? parseInstant(job?.progressSnapshot?.startedAt)

  if (claimedAt != null) return Math.max(0, claimedAt - queuedAt)

  // Still waiting in queue — count through now (or pause).
  if (entry.phase === 'queued' || entry.phase === 'ready' || entry.phase === 'selected') {
    return Math.max(0, nowMs - queuedAt)
  }
  return 0
}

function moduleDatabaseTimeMs(entry: ModuleLifecycleEntry): number {
  return Math.max(0, Number(entry.progress?.progressSnapshot?.databaseTimeMs ?? 0))
}

function moduleApiTimeMs(entry: ModuleLifecycleEntry): number {
  return Math.max(0, Number(entry.progress?.progressSnapshot?.apiTimeMs ?? 0))
}

/**
 * Completed throughput is derived only from modules that finished successfully.
 * Queued, paused, cancelled, and in-flight work never inflate the rate.
 * Denominator is active worker time — never wall-clock elapsed.
 */
export function deriveCompletedThroughput(modules: ModuleLifecycleEntry[]): number | null {
  let completedRecords = 0
  let completedActiveMs = 0
  for (const entry of modules) {
    if (!COMPLETED_PHASES.has(entry.phase)) continue
    const records = Math.max(moduleProcessed(entry), moduleRecords(entry))
    const activeMs = moduleActiveMs(entry, Date.now())
    if (records <= 0 || activeMs <= 0) continue
    completedRecords += records
    completedActiveMs += activeMs
  }
  if (completedRecords < MIN_COMPLETED_RECORDS_FOR_ETA || completedActiveMs < MIN_ACTIVE_MS_FOR_ETA) {
    return null
  }
  return completedRecords / (completedActiveMs / 1000)
}

export function deriveRemainingRecords(modules: ModuleLifecycleEntry[]): number {
  let remaining = 0
  for (const entry of modules) {
    if (COMPLETED_PHASES.has(entry.phase)) continue
    if (entry.phase === 'failed' || entry.phase === 'unsupported' || entry.phase === 'preview_failed') continue
    if (entry.phase === 'cancelled' && moduleProcessed(entry) <= 0) continue
    remaining += Math.max(0, moduleRecords(entry) - moduleProcessed(entry))
  }
  return remaining
}

interface WaterfallPoint {
  id: string
  at: string
  atMs: number
  label: string
  moduleKey: string | null
  kind: MigrationTimingWaterfallKind
}

/**
 * Builds a chronological execution waterfall from persisted session/job evidence.
 * Inserts explicit idle_gap rows wherever consecutive markers are >100ms apart
 * and that span is not already covered by a queue_wait or worker interval.
 */
export function buildMigrationTimingWaterfall(
  session: HydratedMigrationSession,
  nowMs: number = Date.now(),
): MigrationTimingWaterfallEntry[] {
  const points: WaterfallPoint[] = []
  const spans: MigrationTimingWaterfallEntry[] = []
  const startedAt = session.config.startedAt || session.createdAt
  const startedMs = parseInstant(startedAt)
  if (startedMs != null) {
    points.push({
      id: 'session:start',
      at: startedAt,
      atMs: startedMs,
      label: 'Migration started',
      moduleKey: null,
      kind: 'session',
    })
  }

  for (const entry of orderedModules(session.lifecycle)) {
    const job = session.jobs[entry.key]
      ?? Object.values(session.jobs).find((candidate) => candidate.id === entry.jobId)
    const queueJob = entry.jobId
      ? Object.values(session.queueJobs ?? {}).find((row) => row.importJobId === entry.jobId)
      : null

    const queuedAtIso = job?.createdAt ?? queueJob?.createdAt ?? queueJob?.scheduledAt ?? null
    const queuedAtMs = parseInstant(queuedAtIso)
    if (queuedAtIso && queuedAtMs != null) {
      points.push({
        id: `${entry.key}:queued`,
        at: queuedAtIso,
        atMs: queuedAtMs,
        label: `${entry.label} queued`,
        moduleKey: entry.key,
        kind: 'queue_wait',
      })
    }

    const claimedIso = job?.startedAt ?? queueJob?.startedAt ?? job?.progressSnapshot?.startedAt ?? null
    const claimedMs = parseInstant(claimedIso)
    if (claimedIso && claimedMs != null) {
      points.push({
        id: `${entry.key}:claimed`,
        at: claimedIso,
        atMs: claimedMs,
        label: `Worker claimed ${entry.label}`,
        moduleKey: entry.key,
        kind: 'worker',
      })
    }

    if (queuedAtIso && queuedAtMs != null && claimedIso && claimedMs != null && claimedMs - queuedAtMs >= WATERFALL_GAP_THRESHOLD_MS) {
      spans.push({
        id: `${entry.key}:queue-wait`,
        label: `Queue wait · ${entry.label}`,
        moduleKey: entry.key,
        kind: 'queue_wait',
        startedAt: queuedAtIso,
        endedAt: claimedIso,
        durationMs: claimedMs - queuedAtMs,
      })
    }

    const events = job?.activityEvents ?? entry.progress?.activityEvents ?? []
    for (const event of events) {
      const atMs = parseInstant(event.at)
      if (atMs == null) continue
      points.push({
        id: event.id,
        at: event.at,
        atMs,
        label: event.message || event.type,
        moduleKey: entry.key,
        kind: 'stage',
      })
      if (event.type === 'stage_completed' && event.durationMs != null && event.durationMs >= WATERFALL_GAP_THRESHOLD_MS && event.stage) {
        const stageStartMs = atMs - event.durationMs
        spans.push({
          id: `${event.id}:stage`,
          label: `${entry.label} · ${event.stage.replaceAll('_', ' ')}`,
          moduleKey: entry.key,
          kind: 'stage',
          startedAt: new Date(stageStartMs).toISOString(),
          endedAt: event.at,
          durationMs: event.durationMs,
        })
      }
    }

    const finishedIso = job?.updatedAt
      ?? (COMPLETED_PHASES.has(entry.phase) || entry.phase === 'failed' || entry.phase === 'cancelled'
        ? session.updatedAt
        : null)
    const finishedMs = parseInstant(finishedIso)
    if (finishedIso && finishedMs != null && (COMPLETED_PHASES.has(entry.phase) || entry.phase === 'failed' || entry.phase === 'cancelled')) {
      points.push({
        id: `${entry.key}:finished`,
        at: finishedIso,
        atMs: finishedMs,
        label: `${entry.label} ${entry.phase.replaceAll('_', ' ')}`,
        moduleKey: entry.key,
        kind: 'worker',
      })
    }

    if (claimedIso && claimedMs != null) {
      const activeEndMs = finishedMs
        ?? (ACTIVE_PHASES.has(entry.phase) ? nowMs : null)
      const activeEndIso = finishedIso
        ?? (ACTIVE_PHASES.has(entry.phase) ? new Date(nowMs).toISOString() : null)
      const activeMs = moduleActiveMs(entry, nowMs)
      if (activeEndMs != null && activeEndIso && activeMs >= WATERFALL_GAP_THRESHOLD_MS) {
        spans.push({
          id: `${entry.key}:active`,
          label: `Active processing · ${entry.label}`,
          moduleKey: entry.key,
          kind: 'worker',
          startedAt: claimedIso,
          endedAt: activeEndIso,
          durationMs: Math.min(activeMs, Math.max(0, activeEndMs - claimedMs)),
        })
      }
    }
  }

  if (session.config.state !== 'running') {
    const endIso = session.updatedAt
    const endMs = parseInstant(endIso)
    if (endMs != null) {
      points.push({
        id: 'session:end',
        at: endIso,
        atMs: endMs,
        label: `Session ${session.config.state}`,
        moduleKey: null,
        kind: 'session',
      })
    }
  }

  points.sort((left, right) => left.atMs - right.atMs || left.id.localeCompare(right.id))

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!
    const current = points[index]!
    const gapMs = current.atMs - previous.atMs
    if (gapMs < WATERFALL_GAP_THRESHOLD_MS) continue

    const coveredBySpan = spans.some((span) => {
      const spanStart = parseInstant(span.startedAt) ?? 0
      const spanEnd = parseInstant(span.endedAt) ?? 0
      return spanStart <= previous.atMs + WATERFALL_GAP_THRESHOLD_MS
        && spanEnd >= current.atMs - WATERFALL_GAP_THRESHOLD_MS
        && (span.kind === 'queue_wait' || span.kind === 'worker' || span.kind === 'stage')
    })
    if (coveredBySpan) continue

    spans.push({
      id: `gap:${previous.id}:${current.id}`,
      label: `Idle gap · ${previous.label} → ${current.label}`,
      moduleKey: current.moduleKey ?? previous.moduleKey,
      kind: 'idle_gap',
      startedAt: previous.at,
      endedAt: current.at,
      durationMs: gapMs,
    })
  }

  spans.sort((left, right) => {
    const leftStart = parseInstant(left.startedAt) ?? 0
    const rightStart = parseInstant(right.startedAt) ?? 0
    return leftStart - rightStart || left.durationMs - right.durationMs
  })
  return spans
}

export function deriveMigrationTiming(
  session: HydratedMigrationSession,
  nowMs: number = Date.now(),
): MigrationTimingSnapshot {
  const modules = orderedModules(session.lifecycle)
  const startedAt = session.config.startedAt || session.createdAt
  const startedMs = parseInstant(startedAt) ?? nowMs
  const terminal = session.config.state !== 'running'
  const completedAt = terminal ? session.updatedAt : null
  const endMs = terminal
    ? (parseInstant(completedAt) ?? parseInstant(session.updatedAt) ?? nowMs)
    : nowMs

  const elapsedMs = Math.max(0, endMs - startedMs)
  const activeProcessingMs = modules.reduce((sum, entry) => sum + moduleActiveMs(entry, nowMs), 0)
  const queueWaitMs = modules.reduce((sum, entry) => sum + moduleQueueWaitMs(entry, session, nowMs), 0)
  const databaseTimeMs = modules.reduce((sum, entry) => sum + moduleDatabaseTimeMs(entry), 0)
  const apiTimeMs = modules.reduce((sum, entry) => sum + moduleApiTimeMs(entry), 0)
  // Idle = wall clock not spent in the worker. Queue wait is called out separately
  // but remains part of this idle bucket for the primary "waiting" figure.
  const idleMs = Math.max(0, elapsedMs - activeProcessingMs)
  const completedThroughput = deriveCompletedThroughput(modules)
  const remainingRecords = deriveRemainingRecords(modules)

  let remainingMs: number | null = null
  if (terminal) {
    remainingMs = 0
  } else if (remainingRecords <= 0) {
    remainingMs = 0
  } else if (completedThroughput != null && completedThroughput > 0) {
    // ETA uses active-execution throughput only — never wall-clock elapsed.
    remainingMs = Math.round((remainingRecords / completedThroughput) * 1000)
  }

  if (
    remainingMs != null
    && remainingMs > 0
    && completedThroughput == null
  ) {
    remainingMs = null
  }

  return {
    startedAt,
    completedAt,
    elapsedMs,
    activeProcessingMs,
    queueWaitMs,
    idleMs,
    databaseTimeMs,
    apiTimeMs,
    completedThroughput,
    remainingRecords,
    remainingMs,
    etaLabel: remainingMs == null ? ETA_ESTIMATING_LABEL : formatTimingDuration(remainingMs),
    waterfall: buildMigrationTimingWaterfall(session, nowMs),
  }
}

export function formatTimingDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  if (hours > 0) return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`
  return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`
}
