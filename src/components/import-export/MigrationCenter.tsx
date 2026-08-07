'use client'

import { startTransition, useEffect, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Database,
  Gauge,
  ListOrdered,
  Server,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import {
  buildMigrationCenterView,
  formatMigrationDuration,
} from '@/lib/import-export/wizard/migration-center-view'
import {
  MODULE_PHASE_LABEL,
  type ModuleLifecycleEntry,
  type ModuleLifecyclePhase,
} from '@/lib/import-export/wizard/module-lifecycle'
import type { HydratedMigrationSession } from '@/lib/import-export/wizard/migration-session'

const PHASE_BADGE_TONE: Record<ModuleLifecyclePhase, string> = {
  selected: 'bg-slate-100 text-slate-600',
  previewing: 'bg-indigo-100 text-indigo-700',
  ready: 'bg-emerald-100 text-emerald-700',
  unsupported: 'bg-amber-100 text-amber-800',
  preview_failed: 'bg-red-100 text-red-700',
  queued: 'bg-slate-200 text-slate-700',
  claimed: 'bg-indigo-100 text-indigo-700',
  processing: 'bg-indigo-600 text-white',
  paused: 'bg-amber-100 text-amber-800',
  completed: 'bg-emerald-600 text-white',
  completed_with_warnings: 'bg-amber-500 text-white',
  failed: 'bg-red-600 text-white',
  cancelled: 'bg-slate-500 text-white',
}

function Metric({ label, value, icon }: { label: string; value: string; icon?: ReactNode }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <p className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-slate-400">{icon}{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-800">{value}</p>
    </div>
  )
}

function ModuleChipList({ title, modules }: { title: string; modules: ModuleLifecycleEntry[] }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-800">{title} ({modules.length})</h3>
      <ul className="mt-3 space-y-2">
        {modules.length === 0 && <li className="text-sm text-slate-400">None</li>}
        {modules.map((entry) => (
          <li key={entry.key} data-module-key={entry.key} data-module-phase={entry.phase} className="flex items-center justify-between gap-2 text-sm">
            <span className="truncate text-slate-700">{entry.label}</span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${PHASE_BADGE_TONE[entry.phase]}`}>
              {MODULE_PHASE_LABEL[entry.phase]}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function SkeletonBlock({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-slate-100 ${className ?? ''}`} />
}

/** Immediate shell while the provider hydrates the session for this route. */
export function MigrationCenterSkeleton() {
  return (
    <div className="mx-auto max-w-[1600px] space-y-5 p-6" data-migration-center-skeleton aria-busy="true" aria-label="Loading Migration Center">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <SkeletonBlock className="h-3 w-40" />
          <SkeletonBlock className="h-8 w-64" />
          <SkeletonBlock className="h-4 w-48" />
        </div>
        <div className="flex gap-2">
          <SkeletonBlock className="h-9 w-24" />
          <SkeletonBlock className="h-9 w-32" />
        </div>
      </div>
      <SkeletonBlock className="h-36 w-full rounded-2xl" />
      <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
        <SkeletonBlock className="h-80 w-full rounded-2xl" />
        <div className="space-y-4">
          <SkeletonBlock className="h-48 w-full rounded-2xl" />
          <div className="grid gap-4 md:grid-cols-2">
            <SkeletonBlock className="h-40 w-full rounded-2xl" />
            <SkeletonBlock className="h-40 w-full rounded-2xl" />
          </div>
        </div>
      </div>
      <p className="text-center text-sm text-slate-500">Restoring migration from persisted session…</p>
    </div>
  )
}

export function MigrationCenter({
  session,
  onRetry,
  onCancel,
  actionError,
  busy,
}: {
  session: HydratedMigrationSession
  onRetry?: () => void
  onCancel?: () => void
  actionError?: string | null
  busy?: boolean
}) {
  // Core overview paints first; timeline / logs / final report build after commit.
  const [includeHeavy, setIncludeHeavy] = useState(false)
  useEffect(() => {
    const handle = window.setTimeout(() => {
      startTransition(() => setIncludeHeavy(true))
    }, 0)
    return () => window.clearTimeout(handle)
  }, [session.id])

  const view = useMemo(
    () => buildMigrationCenterView(session, Date.now(), { includeHeavy }),
    [session, includeHeavy],
  )
  const progress = view.currentModule?.progress ?? null
  const snapshot = progress?.progressSnapshot ?? {}
  const stageRows = Object.entries(snapshot.stages ?? {})
  const headline = view.currentModule
    ? view.executionHealth?.label ?? MODULE_PHASE_LABEL[view.currentModule.phase]
    : view.overall.queued > 0
      ? view.executionHealth?.label ?? MODULE_PHASE_LABEL.queued
      : view.status === 'completed'
        ? 'Completed'
        : 'Finishing up'

  return (
    <div className="mx-auto max-w-[1600px] space-y-5 p-6" data-migration-center={view.sessionId} data-migration-status={view.status}>
      <PageHeader
        title="Migration Center"
        subtitle={`${view.companyName ?? view.sourceLabel ?? 'QuickBooks'} · ${view.status}`}
        breadcrumb={[
          { label: 'Administration' },
          { label: 'Migration History', href: '/migration-history' },
          { label: 'Migration Center' },
        ]}
        action={(
          <div className="flex flex-wrap gap-2">
            <Link
              href="/migration-history"
              className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              History
            </Link>
            {view.status === 'failed' && onRetry && (
              <Button loading={busy} onClick={onRetry}>Retry</Button>
            )}
            {view.status === 'cancelled' && onRetry && (
              <Button loading={busy} onClick={onRetry}>Resume Migration</Button>
            )}
            {view.canCancel && onCancel && (
              <Button
                variant="outline"
                loading={busy}
                data-cancel-migration
                onClick={onCancel}
              >
                Cancel Migration
              </Button>
            )}
            {view.status === 'completed' && (
              <a
                href="#final-report"
                className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                View Report
              </a>
            )}
          </div>
        )}
      />

      {actionError && (
        <p role="alert" className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{actionError}</p>
      )}
      {view.cancellingActiveBatch && (
        <p
          role="status"
          data-cancel-finishing-batch
          className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700"
        >
          Migration cancelled. The current module will finish its active batch before stopping. Completed modules will remain available.
        </p>
      )}
      {view.executionHealth?.warning && (
        <section
          role="alert"
          aria-label="Worker Not Running"
          data-worker-warning={view.executionHealth.warning}
          className="rounded-2xl border border-amber-300 bg-amber-50 p-5 text-amber-950 shadow-sm"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle size={22} className="mt-0.5 flex-none text-amber-700" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold">Worker Not Running</h2>
              <p className="mt-1 text-sm font-medium">{view.executionHealth.warningMessage}</p>
              <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                <div>
                  <dt className="text-amber-700">Time waiting</dt>
                  <dd className="mt-0.5 font-semibold tabular-nums">{formatMigrationDuration(view.executionHealth.waitingMs)}</dd>
                </div>
                <div>
                  <dt className="text-amber-700">Last queue update</dt>
                  <dd className="mt-0.5 font-semibold">
                    {view.executionHealth.lastQueueUpdateAt
                      ? new Date(view.executionHealth.lastQueueUpdateAt).toLocaleString()
                      : 'No queue update recorded'}
                  </dd>
                </div>
              </dl>
              {view.executionHealth.suggestedAction && (
                <p className="mt-3 text-sm"><span className="font-semibold">Suggested action:</span> {view.executionHealth.suggestedAction}</p>
              )}
              {view.executionHealth.retryAppropriate && onRetry && (
                <Button className="mt-4" loading={busy} onClick={onRetry}>Retry</Button>
              )}
            </div>
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-label="Overview">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-indigo-600">Overall Progress</p>
            <h2 className="mt-1 text-2xl font-bold text-slate-900">{view.overall.percent.toFixed(0)}% complete</h2>
            <p className="mt-1 text-sm text-slate-500">
              {view.overall.completed} of {view.overall.total} modules · {headline}
              {view.currentModule ? ` · ${view.currentModule.label}` : ''}
              {view.currentStage ? ` · ${String(view.currentStage).replaceAll('_', ' ')}` : ''}
            </p>
          </div>
          <span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
            view.status === 'completed' ? 'bg-emerald-50 text-emerald-700'
              : view.status === 'failed' ? 'bg-red-50 text-red-700'
                : view.status === 'cancelled' ? 'bg-slate-100 text-slate-600'
                : 'bg-indigo-50 text-indigo-700'
          }`}>
            {view.status === 'running' ? view.executionHealth?.label ?? 'Queued'
              : view.status === 'cancelled' ? 'Cancelled'
                : view.status}
          </span>
        </div>
        <div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-indigo-600 transition-all duration-700" style={{ width: `${view.overall.percent}%` }} />
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <Metric label="Elapsed Time" value={formatMigrationDuration(view.elapsedMs)} icon={<Clock3 size={15} />} />
          <Metric label="Active Processing" value={formatMigrationDuration(view.activeProcessingMs)} icon={<Gauge size={15} />} />
          <Metric label="Queue Wait" value={formatMigrationDuration(view.queueWaitMs)} icon={<ListOrdered size={15} />} />
          <Metric label="Waiting / Idle" value={formatMigrationDuration(view.idleMs)} icon={<Clock3 size={15} />} />
          <Metric label="Database Wait" value={formatMigrationDuration(view.databaseWaitMs)} icon={<Database size={15} />} />
          <Metric label="ETA" value={view.etaLabel} icon={<Activity size={15} />} />
        </div>
        <p className="mt-2 text-[11px] text-slate-400">
          Elapsed is wall-clock from migration start (includes queue and idle). Active Processing and ETA use worker execution only.
          Database Wait is time spent awaiting DB inside the worker and is already part of Active Processing.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Metric label="Average speed" value={view.performance.averageThroughput == null ? '—' : `${view.performance.averageThroughput.toFixed(1)} rows/s`} icon={<Gauge size={15} />} />
          <Metric label="Current Batch" value={view.currentBatch == null ? '—' : `${view.currentBatch}${view.totalBatches ? ` / ${view.totalBatches}` : ''}`} icon={<Database size={15} />} />
          <Metric label="API wait" value={formatMigrationDuration(view.apiWaitMs)} />
          <Metric label="Imported" value={view.overall.importedCount.toLocaleString()} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Metric label="Updated" value={view.overall.updatedCount.toLocaleString()} />
          <Metric label="Skipped" value={view.overall.skippedCount.toLocaleString()} />
          <Metric label="Failed" value={view.overall.failedCount.toLocaleString()} />
        </div>
        {view.timingWaterfall.length > 0 && (
          <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50/80 p-3" data-migration-timing-waterfall>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Timing waterfall (gaps ≥ 100ms)
            </p>
            <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs">
              {view.timingWaterfall.map((span) => (
                <li
                  key={span.id}
                  data-waterfall-kind={span.kind}
                  className="grid grid-cols-[5.5rem_1fr_auto] gap-2 rounded-lg px-2 py-1.5 hover:bg-white"
                >
                  <span className="font-medium tabular-nums text-slate-500">
                    {formatMigrationDuration(span.durationMs)}
                  </span>
                  <span className="min-w-0 truncate text-slate-700" title={span.label}>{span.label}</span>
                  <span className="text-[10px] uppercase tracking-wide text-slate-400">{span.kind.replaceAll('_', ' ')}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
        <aside className="rounded-2xl border border-slate-200 bg-white p-3" aria-label="Modules">
          <p className="flex items-center gap-1.5 px-2 pb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
            <ListOrdered size={13} /> Modules
          </p>
          <div className="space-y-1">
            {view.allModules.map((entry) => (
              <div
                key={entry.key}
                data-module-key={entry.key}
                className={`flex items-center gap-2 rounded-lg px-2 py-2 text-sm ${entry.key === view.currentModule?.key ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600'}`}
              >
                <span className={`flex h-5 w-5 items-center justify-center rounded-full text-xs ${PHASE_BADGE_TONE[entry.phase]}`}>
                  {entry.phase === 'completed' ? '✓' : entry.phase === 'completed_with_warnings' ? '!' : entry.phase === 'failed' || entry.phase === 'preview_failed' ? '×' : entry.phase === 'processing' || entry.phase === 'claimed' ? '›' : '·'}
                </span>
                <span className="min-w-0 flex-1 truncate" title={`${entry.label} — ${MODULE_PHASE_LABEL[entry.phase]}`}>{entry.label}</span>
                <span className="whitespace-nowrap text-[10px] text-slate-400">
                  {entry.phase === 'queued' && entry.queuePosition !== null
                    ? `#${entry.queuePosition}`
                    : entry.durationMs
                      ? formatMigrationDuration(entry.durationMs)
                      : view.moduleExecutionHealth[entry.key]?.label ?? MODULE_PHASE_LABEL[entry.phase]}
                </span>
              </div>
            ))}
          </div>
        </aside>

        <div className="space-y-4">
          <section className="rounded-2xl border border-slate-200 bg-white p-5" aria-label="Current Module">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Current Module</p>
                <h3 className="mt-1 text-lg font-semibold text-slate-900">{view.currentModule?.label ?? (view.status === 'completed' ? 'All modules finished' : 'Waiting for the next module')}</h3>
                <p className="text-sm text-slate-500">
                  {view.currentRecord
                    ? `Current Record: ${view.currentRecord}`
                    : view.currentStage
                      ? `Current Stage: ${String(view.currentStage).replaceAll('_', ' ')}`
                      : 'Processing next batch'}
                </p>
              </div>
              <div className="text-right text-sm text-slate-500">
                <p>{(progress?.processedRows ?? 0).toLocaleString()} / {(progress?.totalRows ?? 0).toLocaleString()} records</p>
                <p>{progress?.estimatedRemaining?.toLocaleString() ?? '—'} remaining</p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
              {([['Fetched', progress?.processedRows ?? 0], ['Imported', progress?.importedCount ?? 0], ['Updated', progress?.updatedCount ?? 0], ['Skipped', progress?.skippedCount ?? 0], ['Failed', progress?.failedCount ?? 0]] as const).map(([label, value]) => (
                <div key={label} className="rounded-xl bg-slate-50 p-3">
                  <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
                  <p className="mt-1 text-lg font-bold text-slate-800">{value.toLocaleString()}</p>
                </div>
              ))}
            </div>
            {stageRows.length > 0 && (
              <div className="mt-5 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Current Stage</p>
                {stageRows.map(([stage, value]) => (
                  <div key={stage}>
                    <div className="mb-1 flex justify-between text-xs text-slate-500">
                      <span>{stage.replaceAll('_', ' ')}</span>
                      <span>{value.status}{value.durationMs ? ` · ${formatMigrationDuration(value.durationMs)}` : ''}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={`h-full rounded-full ${value.status === 'failed' ? 'bg-red-500' : value.status === 'completed' ? 'bg-emerald-500' : 'bg-indigo-500 animate-pulse'}`}
                        style={{ width: `${value.progress ?? (value.status === 'completed' ? 100 : 35)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <div className="grid gap-4 md:grid-cols-2">
            <ModuleChipList title="Completed Modules" modules={view.completedModules} />
            <ModuleChipList title="Cancelled Modules" modules={view.cancelledModules} />
            <ModuleChipList title="Remaining Modules Not Executed" modules={view.remainingModules} />
            <ModuleChipList title="Processing Modules" modules={view.processingModules} />
            <ModuleChipList title="Failed Modules" modules={view.failedModules} />
            <ModuleChipList title="Queued Modules" modules={view.queuedModules} />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <section className="rounded-2xl border border-slate-200 bg-white p-5" aria-label="Activity Timeline">
              <div className="mb-3 flex items-center gap-2">
                <Activity size={16} className="text-indigo-600" />
                <h3 className="font-semibold text-slate-800">Activity Timeline</h3>
              </div>
              <div className="max-h-96 space-y-1 overflow-y-auto" data-migration-activity-timeline>
                {!includeHeavy ? (
                  <p className="text-sm text-slate-400" data-timeline-loading>Loading activity…</p>
                ) : view.activityTimeline.length ? view.activityTimeline.map((event) => (
                  <div
                    key={event.id}
                    data-activity-type={event.type}
                    className="grid grid-cols-[3.5rem_0.5rem_1fr] gap-2 rounded-lg px-2 py-2 text-xs hover:bg-slate-50"
                  >
                    <time
                      dateTime={event.at}
                      title={new Date(event.at).toLocaleString()}
                      className="whitespace-nowrap font-medium tabular-nums text-slate-500"
                    >
                      {new Date(event.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </time>
                    <span className={`mt-1 h-2 w-2 rounded-full ${
                      event.severity === 'error' ? 'bg-red-500'
                        : event.severity === 'warning' ? 'bg-amber-500'
                          : event.severity === 'success' ? 'bg-emerald-500'
                            : 'bg-indigo-500'
                    }`} aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="font-medium text-slate-700">{event.message}</p>
                      <p className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-slate-400">
                        <span className="font-medium text-slate-500">{event.module}</span>
                        {event.stage && <span>{event.stage.replaceAll('_', ' ')}</span>}
                        {event.durationMs != null && <span>{formatMigrationDuration(event.durationMs)}</span>}
                        {event.warningCount > 0 && (
                          <span className="font-medium text-amber-700">
                            {event.warningCount.toLocaleString()} warning{event.warningCount === 1 ? '' : 's'}
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                )) : (
                  <p className="text-sm text-slate-400">Waiting for the worker to report activity…</p>
                )}
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5" aria-label="Performance Metrics">
              <h3 className="mb-3 font-semibold text-slate-800">Performance Metrics</h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <Metric label="API requests" value={String(view.performance.apiRequests)} />
                <Metric label="Database queries" value={String(view.performance.databaseQueries)} />
                <Metric label="Database writes" value={String(view.performance.databaseWrites)} />
                <Metric label="DB time" value={view.performance.databaseTimeMs ? `${(view.performance.databaseTimeMs / 1000).toFixed(1)}s` : '—'} />
                <Metric label="Retries" value={String(view.performance.retryCount)} />
                <Metric label="Memory" value={view.performance.memoryBytes ? `${(view.performance.memoryBytes / 1024 / 1024).toFixed(1)} MB` : '—'} />
              </div>
            </section>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <section className="rounded-2xl border border-slate-200 bg-white p-5" aria-label="Worker Status">
              <div className="mb-3 flex items-center gap-2">
                <Server size={16} className="text-slate-500" />
                <h3 className="font-semibold text-slate-800">Worker Status</h3>
              </div>
              <p className="text-sm font-medium text-slate-700" data-worker-status={view.workerStatus}>
                {view.executionHealth?.label ?? 'Idle'}
              </p>
              {view.executionHealth?.workerClaimedAt && (
                <p className="mt-2 text-xs text-slate-500">
                  Claimed: {new Date(view.executionHealth.workerClaimedAt).toLocaleString()}
                </p>
              )}
              <p className="mt-2 text-xs text-slate-500">
                {view.executionHealth?.lastHeartbeatAt
                  ? `Last heartbeat: ${new Date(view.executionHealth.lastHeartbeatAt).toLocaleString()}`
                  : 'No worker heartbeat recorded.'}
              </p>
            </section>
            <section className="rounded-2xl border border-slate-200 bg-white p-5" aria-label="Queue Status">
              <h3 className="mb-3 font-semibold text-slate-800">Queue Status</h3>
              <p className="text-sm font-medium text-slate-700">{view.executionHealth?.label ?? 'Idle'}</p>
              <p className="mt-1 text-sm text-slate-700" data-queue-depth={view.queueStatus.depth}>
                {view.queueStatus.depth} module{view.queueStatus.depth === 1 ? '' : 's'} waiting
              </p>
              <p className="mt-2 text-xs text-slate-500">
                Next: {view.queueStatus.nextLabel ?? '—'}
              </p>
              {view.queueStatus.waitingMs > 0 && (
                <p className="mt-1 text-xs text-slate-500">Waiting: {formatMigrationDuration(view.queueStatus.waitingMs)}</p>
              )}
              <p className="mt-1 text-xs text-slate-500">
                Last update: {view.queueStatus.lastQueueUpdateAt
                  ? new Date(view.queueStatus.lastQueueUpdateAt).toLocaleString()
                  : '—'}
              </p>
            </section>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <section className="rounded-2xl border border-slate-200 bg-white p-5" aria-label="Warnings">
              <h3 className="mb-3 font-semibold text-slate-800">Warnings</h3>
              {view.warnings.length === 0 ? (
                <p className="text-sm text-slate-400">No warnings</p>
              ) : (
                <ul className="space-y-2 text-sm text-amber-800">
                  {view.warnings.map((item) => (
                    <li key={item.module}>{item.module}: {item.count.toLocaleString()} warning{item.count === 1 ? '' : 's'}</li>
                  ))}
                </ul>
              )}
            </section>
            <section className="rounded-2xl border border-slate-200 bg-white p-5" aria-label="Errors">
              <div className="mb-3 flex items-center gap-2">
                <AlertCircle size={16} className="text-red-500" />
                <h3 className="font-semibold text-slate-800">Errors</h3>
              </div>
              {view.errors.length === 0 ? (
                <p className="text-sm text-slate-400">No errors</p>
              ) : (
                <ul className="space-y-2 text-sm text-red-700">
                  {view.errors.map((item) => (
                    <li key={`${item.module}-${item.errorCode ?? item.message}`}>
                      <span className="font-medium">{item.module}</span>
                      {item.stage ? <span className="text-slate-600"> · {item.stage.replaceAll('_', ' ')}</span> : null}
                      <span className="mt-0.5 block">{item.message}</span>
                      <span className="mt-0.5 block text-xs text-slate-500">
                        {item.errorCode ?? '—'}
                        {item.rowNumber != null && item.rowNumber > 0 ? ` · row ${item.rowNumber}` : ''}
                        {item.retryable ? ' · retryable' : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <section className="rounded-2xl border border-slate-200 bg-white p-5" aria-label="Logs" id="logs">
            <h3 className="mb-3 font-semibold text-slate-800">Logs</h3>
            <div className="max-h-80 overflow-y-auto rounded-xl bg-slate-950 p-4 font-mono text-xs text-slate-100">
              {view.logs.length === 0 ? (
                <p className="text-slate-400">No log events persisted yet.</p>
              ) : view.logs.map((event) => (
                <p key={`log-${event.id}`} className="whitespace-pre-wrap py-0.5">
                  [{new Date(event.at).toISOString()}] {event.type} {event.module ? `(${event.module})` : ''} {event.message}
                </p>
              ))}
            </div>
          </section>

          {view.finalReport && (
            <section id="final-report" className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-5" aria-label="Final Report">
              <div className="flex items-start gap-3">
                <CheckCircle2 size={22} className="mt-0.5 text-emerald-600" />
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold text-emerald-900">Final Report</h3>
                  <p className="mt-1 text-sm text-emerald-800">
                    Validation {view.finalReport.validationScore}% · Integrity {view.finalReport.integrityScore}% · Duration {formatMigrationDuration(view.finalReport.durationMs)}
                  </p>
                  <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
                    {([
                      ['Imported', view.finalReport.totals.imported],
                      ['Updated', view.finalReport.totals.updated],
                      ['Skipped', view.finalReport.totals.skipped],
                      ['Failed', view.finalReport.totals.failures],
                    ] as const).map(([label, count]) => (
                      <div key={label} className="rounded-xl border border-emerald-100 bg-white p-3 text-center">
                        <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
                        <p className="mt-1 text-xl font-bold text-slate-800">{count.toLocaleString()}</p>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-emerald-100 text-xs uppercase tracking-wide text-slate-400">
                          <th className="py-2 pr-3">Module</th>
                          <th className="py-2 pr-3">Imported</th>
                          <th className="py-2 pr-3">Updated</th>
                          <th className="py-2 pr-3">Skipped</th>
                          <th className="py-2">Failed</th>
                        </tr>
                      </thead>
                      <tbody>
                        {view.finalReport.modules.map((moduleReport) => (
                          <tr key={moduleReport.key} className="border-b border-emerald-50">
                            <td className="py-2 pr-3 font-medium text-slate-800">{moduleReport.label}</td>
                            <td className="py-2 pr-3">{moduleReport.importedCount.toLocaleString()}</td>
                            <td className="py-2 pr-3">{moduleReport.updatedCount.toLocaleString()}</td>
                            <td className="py-2 pr-3">{moduleReport.skippedCount.toLocaleString()}</td>
                            <td className="py-2">{moduleReport.failedCount.toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
