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

const COMPLETED_PHASES = new Set<ModuleLifecyclePhase>(['completed', 'completed_with_warnings'])
const ACTIVE_PHASES = new Set<ModuleLifecyclePhase>(['processing', 'claimed'])

export interface MigrationTimingSnapshot {
  startedAt: string
  completedAt: string | null
  /** Wall-clock time since migration start (includes queue/pause idle). */
  elapsedMs: number
  /** Time spent inside claimed worker steps only. */
  activeProcessingMs: number
  /** Completed-module throughput in records/second, or null when insufficient history. */
  completedThroughput: number | null
  remainingRecords: number
  remainingMs: number | null
  etaLabel: string
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

/**
 * Completed throughput is derived only from modules that finished successfully.
 * Queued, paused, cancelled, and in-flight work never inflate the rate.
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
  const completedThroughput = deriveCompletedThroughput(modules)
  const remainingRecords = deriveRemainingRecords(modules)

  let remainingMs: number | null = null
  if (terminal) {
    // Cancelled/completed/failed sessions are finished; do not invent a future ETA.
    remainingMs = 0
  } else if (remainingRecords <= 0) {
    remainingMs = 0
  } else if (completedThroughput != null && completedThroughput > 0) {
    remainingMs = Math.round((remainingRecords / completedThroughput) * 1000)
  }

  // Prefer completed-throughput math. Reject only clearly impossible claims that
  // somehow still slip through without a completed rate (defensive no-op today).
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
    completedThroughput,
    remainingRecords,
    remainingMs,
    etaLabel: remainingMs == null ? ETA_ESTIMATING_LABEL : formatTimingDuration(remainingMs),
  }
}

export function formatTimingDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  if (hours > 0) return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`
  return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`
}
