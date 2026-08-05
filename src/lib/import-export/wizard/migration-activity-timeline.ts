import type { MigrationActivityEvent } from '../types'
import type { HydratedMigrationSession } from './migration-session'
import { orderedModules, type ModuleLifecycleEntry } from './module-lifecycle'

export type MigrationTimelineSeverity = 'info' | 'success' | 'warning' | 'error'

export interface MigrationTimelineEntry {
  id: string
  at: string
  moduleKey: string
  module: string
  stage: string | null
  message: string
  type: string
  durationMs: number | null
  warningCount: number
  severity: MigrationTimelineSeverity
}

function stageLabel(stage: string): string {
  return stage
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function normalizedMessage(event: MigrationActivityEvent): string {
  const stage = event.stage ? stageLabel(event.stage) : null
  if (event.type === 'stage_completed' && stage) return `${stage} completed`
  if (event.type === 'stage_started' && stage) return `${stage} started`
  if (event.type === 'stage_failed' && stage) return `${stage} failed`
  if (event.type === 'batch_completed' && event.stage === 'extraction' && event.records != null) {
    return `Fetched ${event.records.toLocaleString()} records`
  }
  return event.message
}

function eventSeverity(event: MigrationActivityEvent): MigrationTimelineSeverity {
  if (event.type === 'stage_failed') return 'error'
  if ((event.warningCount ?? 0) > 0) return 'warning'
  if (event.type === 'stage_completed' || event.type === 'batch_completed') return 'success'
  return 'info'
}

function rawTimelineEntry(
  event: MigrationActivityEvent,
  lifecycleEntry: ModuleLifecycleEntry,
): MigrationTimelineEntry {
  const fallbackDuration = event.stage
    ? lifecycleEntry.progress?.progressSnapshot.stages?.[event.stage]?.durationMs
    : null
  return {
    id: event.id,
    at: event.at,
    moduleKey: lifecycleEntry.key,
    module: event.module ?? lifecycleEntry.label,
    stage: event.stage ?? null,
    message: normalizedMessage(event),
    type: event.type,
    durationMs: event.durationMs ?? fallbackDuration ?? null,
    warningCount: Math.max(0, Number(event.warningCount ?? 0)),
    severity: eventSeverity(event),
  }
}

function duplicateSkipCount(summary: Record<string, number> | null | undefined): number {
  if (!summary) return 0
  return Object.entries(summary)
    .filter(([label]) => label.toLowerCase().includes('duplicate'))
    .reduce((sum, [, count]) => sum + Math.max(0, Number(count ?? 0)), 0)
}

function terminalMessage(module: ModuleLifecycleEntry): string | null {
  if (module.phase === 'completed' || module.phase === 'completed_with_warnings') return 'Module completed'
  if (module.phase === 'failed' || module.phase === 'preview_failed') return 'Module failed'
  if (module.phase === 'cancelled') return 'Module cancelled'
  return null
}

/**
 * Builds one live/historical timeline from existing persisted import-job events
 * and timestamps. It creates no second event stream and performs no writes.
 */
export function buildMigrationActivityTimeline(
  session: HydratedMigrationSession,
): MigrationTimelineEntry[] {
  const timeline: Array<MigrationTimelineEntry & { order: number }> = []

  for (const lifecycleEntry of orderedModules(session.lifecycle)) {
    const job = session.jobs[lifecycleEntry.key]
      ?? Object.values(session.jobs).find((candidate) => candidate.id === lifecycleEntry.jobId)
    const events = job?.activityEvents ?? lifecycleEntry.progress?.activityEvents ?? []

    if (job?.startedAt) {
      timeline.push({
        id: `${job.id}:worker-claimed`,
        at: job.startedAt,
        moduleKey: lifecycleEntry.key,
        module: lifecycleEntry.label,
        stage: 'worker',
        message: `Worker claimed ${lifecycleEntry.label}`,
        type: 'worker_claimed',
        durationMs: null,
        warningCount: 0,
        severity: 'info',
        order: 0,
      })
    }

    for (const event of events) {
      timeline.push({ ...rawTimelineEntry(event, lifecycleEntry), order: 1 })
    }

    const duplicateSkips = duplicateSkipCount(job?.skipSummary)
    if (duplicateSkips > 0 && job?.updatedAt) {
      timeline.push({
        id: `${job.id}:duplicates-skipped`,
        at: job.updatedAt,
        moduleKey: lifecycleEntry.key,
        module: lifecycleEntry.label,
        stage: 'duplicate_detection',
        message: `Skipped ${duplicateSkips.toLocaleString()} duplicate record${duplicateSkips === 1 ? '' : 's'}`,
        type: 'records_skipped',
        durationMs: null,
        warningCount: duplicateSkips,
        severity: 'warning',
        order: 2,
      })
    }

    const outcome = terminalMessage(lifecycleEntry)
    if (outcome && job?.updatedAt) {
      const warningCount = Math.max(0, Number(lifecycleEntry.warningCount ?? job.warningCount ?? 0))
      timeline.push({
        id: `${job.id}:module-${lifecycleEntry.phase}`,
        at: job.updatedAt,
        moduleKey: lifecycleEntry.key,
        module: lifecycleEntry.label,
        stage: 'module',
        message: outcome,
        type: `module_${lifecycleEntry.phase}`,
        durationMs: job.durationMs ?? lifecycleEntry.durationMs ?? null,
        warningCount,
        severity: lifecycleEntry.phase === 'failed' || lifecycleEntry.phase === 'preview_failed'
          ? 'error'
          : warningCount > 0 || lifecycleEntry.phase === 'cancelled'
            ? 'warning'
            : 'success',
        order: 3,
      })
    }
  }

  const seen = new Set<string>()
  return timeline
    .filter((entry) => {
      if (seen.has(entry.id)) return false
      seen.add(entry.id)
      return Number.isFinite(Date.parse(entry.at))
    })
    .sort((left, right) => Date.parse(left.at) - Date.parse(right.at) || left.order - right.order)
}
