'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Clock3,
  RefreshCw,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { readApiError } from '@/lib/api-client'
import {
  activeModule,
  applyJobCreated,
  deriveOverallProgress,
  migrationHasStarted,
  orderedModules,
} from '@/lib/import-export/wizard/module-lifecycle'
import { migrationCenterPath } from '@/lib/import-export/wizard/migration-center-view'
import type { HydratedMigrationSession } from '@/lib/import-export/wizard/migration-session'
import { ConnectedSourceFlow } from './steps/ConnectedSourceFlow'

const POLL_INTERVAL_MS = 1_500

interface MigrationSessionContextValue {
  session: HydratedMigrationSession | null
  viewerOpen: boolean
  /** Opens configuration wizard only. Running migrations open Migration Center. */
  openViewer: () => void
  closeViewer: () => void
  openMigrationCenter: (sessionId?: string) => void
  refresh: () => Promise<void>
}

const MigrationSessionContext = createContext<MigrationSessionContextValue | null>(null)

export function useMigrationSession() {
  const value = useContext(MigrationSessionContext)
  if (!value) throw new Error('useMigrationSession must be used inside MigrationSessionProvider')
  return value
}

export function MigrationSessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  const [session, setSession] = useState<HydratedMigrationSession | null>(null)
  const [viewerOpen, setViewerOpen] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const coordinatingRef = useRef(false)
  const mountedRef = useRef(true)

  const openMigrationCenter = useCallback((sessionId?: string) => {
    const id = sessionId ?? session?.id
    if (!id) return
    setViewerOpen(false)
    router.push(migrationCenterPath(id))
  }, [router, session?.id])

  const openViewer = useCallback(() => {
    if (session && (session.config.state === 'running' || migrationHasStarted(session.lifecycle))) {
      openMigrationCenter(session.id)
      return
    }
    if (session && (session.config.state === 'completed' || session.config.state === 'failed')) {
      openMigrationCenter(session.id)
      return
    }
    setViewerOpen(true)
  }, [openMigrationCenter, session])

  const closeViewer = useCallback(() => setViewerOpen(false), [])

  const refresh = useCallback(async () => {
    const response = await fetch('/api/import-export/migration-sessions?includeLatest=true', {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
    })
    if (!response.ok) throw new Error(await readApiError(response))
    const payload = await response.json() as { session: HydratedMigrationSession | null }
    if (mountedRef.current) setSession(payload.session)
  }, [])

  const patchSession = useCallback(async (
    sessionId: string,
    body: Record<string, unknown>,
  ) => {
    const response = await fetch(`/api/import-export/migration-sessions/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!response.ok) throw new Error(await readApiError(response))
  }, [])

  const coordinate = useCallback(async (current: HydratedMigrationSession) => {
    if (coordinatingRef.current || current.config.state !== 'running') return
    coordinatingRef.current = true
    try {
      const modules = orderedModules(current.lifecycle)
      const participating = modules.filter((entry) =>
        entry.phase !== 'unsupported' && entry.phase !== 'preview_failed')

      const failed = participating.find((entry) =>
        entry.phase === 'failed' || entry.phase === 'cancelled')
      if (failed) {
        await patchSession(current.id, {
          lifecycle: current.lifecycle,
          step: 'import',
          state: 'failed',
        })
        return
      }

      const unfinished = participating.find((entry) =>
        entry.phase !== 'completed' && entry.phase !== 'completed_with_warnings')
      if (!unfinished) {
        await patchSession(current.id, {
          lifecycle: current.lifecycle,
          step: 'report',
          state: 'completed',
        })
        return
      }

      if (!unfinished.jobId) {
        const response = await fetch(`/api/import-export/${unfinished.moduleKey}/import`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            background: true,
            sourceKey: current.config.provider,
            resourceKey: unfinished.key,
            filename: `${current.config.sourceLabel ?? 'QuickBooks'} - ${unfinished.label}`,
            fileFormat: 'csv',
            duplicateStrategy: current.config.duplicateStrategy,
          }),
        })
        if (!response.ok) throw new Error(await readApiError(response))
        const created = await response.json() as { jobId?: string }
        if (!created.jobId) throw new Error(`${unfinished.label}: migration job did not return an identifier`)
        const lifecycle = applyJobCreated(current.lifecycle, unfinished.key, created.jobId)
        await patchSession(current.id, { lifecycle, step: 'import', state: 'running' })
        return
      }

      const job = current.jobs[unfinished.key]
      if (!job || job.status === 'pending') {
        const response = await fetch(`/api/import-export/jobs/${unfinished.jobId}/run`, {
          method: 'POST',
        })
        if (!response.ok) throw new Error(await readApiError(response))
      }
    } finally {
      coordinatingRef.current = false
    }
  }, [patchSession])

  useEffect(() => {
    mountedRef.current = true
    void refresh().catch((error) => {
      if (mountedRef.current) setActionError(error instanceof Error ? error.message : 'Unable to load migration status.')
    })
    const timer = window.setInterval(() => {
      void refresh().catch(() => undefined)
    }, POLL_INTERVAL_MS)
    const handleSessionChanged = () => void refresh()
    window.addEventListener('quickbooks-migration-session-changed', handleSessionChanged)
    return () => {
      mountedRef.current = false
      window.clearInterval(timer)
      window.removeEventListener('quickbooks-migration-session-changed', handleSessionChanged)
    }
  }, [refresh])

  useEffect(() => {
    if (!session || session.config.state !== 'running') return
    void coordinate(session)
      .then(refresh)
      .catch((error) => setActionError(error instanceof Error ? error.message : 'Migration coordination failed.'))
  }, [coordinate, refresh, session])

  const retry = useCallback(async () => {
    if (!session) return
    setActionError(null)
    const response = await fetch(`/api/import-export/migration-sessions/${session.id}/retry`, {
      method: 'POST',
    })
    if (!response.ok) {
      setActionError(await readApiError(response))
      return
    }
    await refresh()
    openMigrationCenter(session.id)
  }, [openMigrationCenter, refresh, session])

  const handleWizardSuccess = useCallback((createdSessionId?: string) => {
    void refresh()
    if (createdSessionId) {
      setViewerOpen(false)
      router.push(migrationCenterPath(createdSessionId))
    }
  }, [refresh, router])

  const value = useMemo<MigrationSessionContextValue>(() => ({
    session,
    viewerOpen,
    openViewer,
    closeViewer,
    openMigrationCenter,
    refresh,
  }), [closeViewer, openMigrationCenter, openViewer, refresh, session, viewerOpen])

  return (
    <MigrationSessionContext.Provider value={value}>
      {children}
      {session && session.config.state !== 'cancelled' && (
        <MigrationIndicator
          session={session}
          error={actionError}
          onOpen={() => openMigrationCenter(session.id)}
          onRetry={() => void retry()}
          onLogs={() => router.push(`${migrationCenterPath(session.id)}#logs`)}
        />
      )}
      <ConnectedSourceFlow
        open={viewerOpen}
        onClose={() => setViewerOpen(false)}
        onSuccess={handleWizardSuccess}
        initialSource="quickbooks"
      />
    </MigrationSessionContext.Provider>
  )
}

function MigrationIndicator({
  session,
  error,
  onOpen,
  onRetry,
  onLogs,
}: {
  session: HydratedMigrationSession
  error: string | null
  onOpen: () => void
  onRetry: () => void
  onLogs: () => void
}) {
  const overall = deriveOverallProgress(session.lifecycle)
  const current = activeModule(session.lifecycle)
  const state = session.config.state
  const completed = state === 'completed'
  const failed = state === 'failed'

  return (
    <aside
      aria-label="QuickBooks migration status"
      aria-live="polite"
      data-global-migration-indicator={state}
      className="fixed bottom-4 right-4 z-40 w-[calc(100%-2rem)] max-w-sm overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-900/15 sm:bottom-6 sm:right-6"
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex min-h-14 w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
      >
        <span className={`flex h-10 w-10 flex-none items-center justify-center rounded-xl ${
          completed ? 'bg-emerald-100 text-emerald-700'
            : failed ? 'bg-red-100 text-red-700'
              : 'bg-indigo-100 text-indigo-700'
        }`}>
          {completed ? <CheckCircle2 size={20} /> : failed ? <AlertCircle size={20} /> : <RefreshCw size={19} className="motion-safe:animate-spin" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-slate-900">
            {completed ? 'Migration Completed' : failed ? 'Migration Failed' : 'QuickBooks Migration'}
          </span>
          <span className="mt-0.5 block truncate text-xs text-slate-600">
            {completed
              ? `${overall.completed} modules completed`
              : failed
                ? 'Migration needs attention'
                : `${overall.percent.toFixed(0)}% · ${current?.label ?? 'Waiting in queue'} · ${current?.progress?.currentStage?.replaceAll('_', ' ') ?? 'Importing…'}`}
          </span>
        </span>
        <ChevronRight size={18} className="flex-none text-slate-400" />
      </button>

      {!completed && !failed && (
        <div className="h-1 bg-slate-100" aria-hidden="true">
          <div className="h-full bg-indigo-600 transition-[width] duration-300" style={{ width: `${overall.percent}%` }} />
        </div>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-3 py-2">
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-slate-500">
          <Clock3 size={13} />
          {completed ? 'View report' : failed ? 'Resume or retry' : 'Continues in background'}
        </span>
        <div className="flex gap-1">
          {failed && <Button size="sm" variant="outline" onClick={onRetry}>Retry</Button>}
          {failed && <Button size="sm" variant="outline" onClick={onLogs}>View Logs</Button>}
          <Button size="sm" onClick={onOpen}>{completed ? 'View Report' : failed ? 'Resume' : 'View Progress'}</Button>
        </div>
      </div>
      {error && <p role="alert" className="border-t border-red-100 bg-red-50 px-4 py-2 text-xs text-red-700">{error}</p>}
    </aside>
  )
}
