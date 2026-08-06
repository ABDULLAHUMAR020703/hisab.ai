/**
 * Pure restore-path timing collector for Migration Center page load.
 * Stages are recorded in order; finalize() returns a millisecond breakdown.
 */

export type MigrationRestoreStage =
  | 'route_mount'
  | 'session_lookup'
  | 'auth'
  | 'db_session_row'
  | 'db_import_jobs'
  | 'db_queue_jobs'
  | 'session_reconcile'
  | 'poll_project'
  | 'api_total'
  | 'client_fetch'
  | 'client_merge'
  | 'view_core'
  | 'view_heavy'
  | 'first_paint'

export interface MigrationRestoreStageSample {
  stage: MigrationRestoreStage
  ms: number
}

export interface MigrationRestoreTimingReport {
  totalMs: number
  stages: MigrationRestoreStageSample[]
  /** Absolute start (performance.now / Date.now) for correlation. */
  startedAt: number
}

export interface MigrationRestoreTimer {
  mark(stage: MigrationRestoreStage): void
  /** Ends an open span started with begin(). */
  end(stage: MigrationRestoreStage): void
  begin(stage: MigrationRestoreStage): void
  finalize(): MigrationRestoreTimingReport
  /** Running elapsed since timer creation. */
  elapsedMs(): number
}

export function createMigrationRestoreTimer(
  now: () => number = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
): MigrationRestoreTimer {
  const startedAt = now()
  const open = new Map<MigrationRestoreStage, number>()
  const stages: MigrationRestoreStageSample[] = []

  return {
    begin(stage) {
      open.set(stage, now())
    },
    end(stage) {
      const start = open.get(stage)
      if (start == null) return
      open.delete(stage)
      stages.push({ stage, ms: Math.max(0, now() - start) })
    },
    mark(stage) {
      stages.push({ stage, ms: Math.max(0, now() - startedAt) })
    },
    elapsedMs() {
      return Math.max(0, now() - startedAt)
    },
    finalize() {
      for (const [stage, start] of open) {
        stages.push({ stage, ms: Math.max(0, now() - start) })
      }
      open.clear()
      return {
        totalMs: Math.max(0, now() - startedAt),
        stages: [...stages],
        startedAt,
      }
    },
  }
}

/** Formats a compact one-line breakdown for logs / tests. */
export function formatMigrationRestoreBreakdown(report: MigrationRestoreTimingReport): string {
  const parts = report.stages.map((sample) => `${sample.stage}=${sample.ms.toFixed(1)}ms`)
  return `total=${report.totalMs.toFixed(1)}ms ${parts.join(' ')}`
}

/**
 * Pure projector: decide whether the first restore poll should omit activity events.
 * Heavy activity payloads defer to a follow-up poll after the core Center paints.
 */
export function shouldDeferActivityOnRestore(input: {
  /** True when this is the first hydrate for the current poll scope. */
  isInitialScopeHydrate: boolean
  /** True when the client already holds activity events for this session. */
  hasCachedActivity: boolean
}): boolean {
  return input.isInitialScopeHydrate && !input.hasCachedActivity
}

/**
 * Pure projector: whether queue/job polling is needed for restore UI.
 * Terminal sessions have no live queue work — skip the job_queue round trip.
 */
export function shouldIncludeQueueHealthOnHydrate(state: string): boolean {
  return state === 'running'
}

/**
 * Whether an in-memory session can paint the Center without waiting on a fresh poll.
 */
export function canPaintCachedMigrationSession(input: {
  routeSessionId: string
  cachedSessionId: string | null | undefined
}): boolean {
  return Boolean(input.cachedSessionId && input.cachedSessionId === input.routeSessionId)
}
