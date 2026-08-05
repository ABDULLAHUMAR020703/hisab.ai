'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Building2, CheckCircle2, Database, ExternalLink, FileCheck2, ListOrdered, PlugZap, RefreshCw, ShieldCheck } from 'lucide-react'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { readApiError } from '@/lib/api-client'
import type { DuplicateMatch, DuplicateStrategy, ValidationResult } from '@/lib/import-export/types'
import { DuplicateStep } from './DuplicateStep'
import type { MigrationReport } from '@/lib/import-export/migration-report'
import { orderQuickBooksMigrationResources } from '@/lib/import-export/quickbooks/dependency-order'
import {
  applyPreviewRequestFailure,
  applyPreviewResults,
  initializeModuleLifecycle,
  markModulesPreviewing,
  migrationHasStarted,
  MODULE_PHASE_LABEL,
  orderedModules,
  type ModuleLifecycleEntry,
  type ModuleLifecyclePhase,
  type ModuleLifecycleState,
} from '@/lib/import-export/wizard/module-lifecycle'
import type { HydratedMigrationSession } from '@/lib/import-export/wizard/migration-session'

interface SourceResource { key: string; label: string; moduleKey: string }
interface ImportSource {
  key: string
  provider?: string
  label: string
  connected: boolean
  connectionStatus: string
  resources: SourceResource[]
  companyName?: string | null
  realmId?: string | null
  baseCurrency?: string | null
  country?: string | null
  connectedAt?: string | null
}
interface PreviewSuccess extends SourceResource {
  status: 'success'
  count: number
  countAccuracy?: 'exact' | 'upper-bound'
  sampled?: boolean
  duplicateDetection?: 'deferred'
  headers: string[]
  rows: Record<string, string>[]
  sampleRows: Record<string, string>[]
  mapping: Record<string, string>
  validation: ValidationResult
  duplicates: DuplicateMatch[]
}
interface PreviewFailure extends SourceResource {
  status: 'error' | 'unsupported'
  stage: string
  module: string | null
  errorCode: string
  message: string
  correlationId: string
}
type PreviewResource = PreviewSuccess | PreviewFailure
interface ImportTotals { importedCount: number; updatedCount: number; skippedCount: number; failedCount: number }
interface CompanyAnalysis {
  companyName: string | null
  fiscalYear: string | null
  country: string | null
  currency: string | null
  realmId: string
  recordCounts: Array<{ key: string; label: string; count: number; supported: boolean }>
  estimatedMigrationMinutes: number
  supportedModules: string[]
  unsupportedModules: string[]
  migrationCoveragePercent: number
}
type Step = 'analyze' | 'modules' | 'validation' | 'import' | 'report'

const STAGES: Array<{ key: Step; label: string }> = [
  { key: 'analyze', label: 'Analyze Company' },
  { key: 'modules', label: 'Module Selection' },
  { key: 'validation', label: 'Validation' },
  { key: 'import', label: 'Import' },
  { key: 'report', label: 'Migration Report' },
]

export function ConnectedSourceFlow({
  open,
  onClose,
  onSuccess,
  persistentSession,
  onCancelSession,
  initialSource,
}: {
  open: boolean
  onClose: () => void
  /** Invoked after a migration session is created or an existing one should open Migration Center. */
  onSuccess?: (sessionId?: string) => void
  persistentSession: HydratedMigrationSession | null
  onCancelSession: (sessionId: string) => Promise<void>
  initialSource?: string
}) {
  const [step, setStep] = useState<Step>('analyze')
  const [sources, setSources] = useState<ImportSource[]>([])
  const [source, setSource] = useState<ImportSource | null>(null)
  const [analysis, setAnalysis] = useState<CompanyAnalysis | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [previews, setPreviews] = useState<PreviewResource[]>([])
  const [strategy, setStrategy] = useState<DuplicateStrategy>('skip')
  const [totals, setTotals] = useState<ImportTotals | null>(null)
  const [report, setReport] = useState<MigrationReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lifecycle, setLifecycle] = useState<ModuleLifecycleState>({})
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [blockedSession, setBlockedSession] = useState<HydratedMigrationSession | null>(null)
  const [sessionBootstrapping, setSessionBootstrapping] = useState(false)
  const sessionIdRef = useRef<string | null>(null)
  const resumeTokenRef = useRef(0)
  const redirectedSessionRef = useRef<string | null>(null)
  const onSuccessRef = useRef(onSuccess)
  const onCloseRef = useRef(onClose)
  onSuccessRef.current = onSuccess
  onCloseRef.current = onClose
  const activeSessionId = persistentSession
    && (persistentSession.config.state === 'running' || migrationHasStarted(persistentSession.lifecycle))
    ? persistentSession.id
    : null

  useEffect(() => {
    sessionIdRef.current = sessionId
  }, [sessionId])

  useEffect(() => {
    if (!open) {
      redirectedSessionRef.current = null
      return
    }
    if (!activeSessionId || redirectedSessionRef.current === activeSessionId) return
    redirectedSessionRef.current = activeSessionId
    onCloseRef.current()
    onSuccessRef.current?.(activeSessionId)
  }, [activeSessionId, open])

  useEffect(() => {
    if (!open || activeSessionId) return
    let active = true
    const token = ++resumeTokenRef.current
    const timer = window.setTimeout(() => {
      setLoading(true)
      setSessionBootstrapping(true)
      setBlockedSession(null)
      setError(null)
      resetLocalWizardState()
      void Promise.all([
        fetch('/api/integrations', { cache: 'no-store' }),
        fetch('/api/import-export/sources', { cache: 'no-store' }),
        fetch('/api/integrations/quickbooks/analyze', { cache: 'no-store' }),
      ]).then(async ([integrationResponse, sourceResponse, analysisResponse]) => {
        if (!integrationResponse.ok) throw new Error(await readApiError(integrationResponse))
        if (!sourceResponse.ok) throw new Error(await readApiError(sourceResponse))
        const integrations = await integrationResponse.json() as ImportSource[]
        const sourceAdapters = await sourceResponse.json() as ImportSource[]
        const analysisPayload = analysisResponse.ok ? await analysisResponse.json() as CompanyAnalysis : null
        const items = sourceAdapters.map((adapter) => ({
          ...adapter,
          ...(integrations.find((item) => item.provider === adapter.key) ?? {}),
          resources: adapter.resources,
        }))
        return { items, analysis: analysisPayload }
      }).then(async ({ items, analysis: analysisPayload }) => {
        if (!active || token !== resumeTokenRef.current) return
        setSources(items)
        setAnalysis(analysisPayload)
        const preferred = items.find((item) => item.key === initialSource && item.connected)
        setSource(preferred ?? items.find((item) => item.connected) ?? null)
        setLoading(false)
        setSessionBootstrapping(false)
      })
      .catch((reason) => {
        if (!active || token !== resumeTokenRef.current) return
        setError(reason instanceof Error ? reason.message : 'Unable to analyze the company.')
        setLoading(false)
        setSessionBootstrapping(false)
      })
    }, 0)
    return () => { active = false; window.clearTimeout(timer) }
  }, [activeSessionId, initialSource, open])

  function resetLocalWizardState() {
    setStep('analyze')
    setSource(null)
    setAnalysis(null)
    setSelected([])
    setPreviews([])
    setStrategy('skip')
    setTotals(null)
    setReport(null)
    setLifecycle({})
    setSessionId(null)
    sessionIdRef.current = null
    setBlockedSession(null)
    setError(null)
  }

  function close() {
    resetLocalWizardState()
    onClose()
  }

  function toggleAllModules() {
    const moduleKeys = source?.resources.map((resource) => resource.key) ?? []
    setSelected((current) => moduleKeys.length > 0 && moduleKeys.every((key) => current.includes(key)) ? [] : moduleKeys)
  }

  async function requestPreview(keys: string[]) {
    if (!source || keys.length === 0) return
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/import-export/sources/${source.key}/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resources: keys }),
      })
      if (!response.ok) throw new Error(await readApiError(response))
      const payload = await response.json() as { resources: PreviewResource[] }
      setPreviews((current) => mergePreviews(current, payload.resources))
      setLifecycle((current) => applyPreviewResults(current, payload.resources))
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Unable to validate source data.'
      setLifecycle((current) => applyPreviewRequestFailure(current, message, keys))
      setError(message)
    } finally {
      setLoading(false)
      setStep('validation')
    }
  }

  async function preview() {
    if (!source || selected.length === 0) return
    const orderedSelection = orderQuickBooksMigrationResources(
      selected
        .map((key) => source.resources.find((resource) => resource.key === key))
        .filter((resource): resource is SourceResource => Boolean(resource)),
    )
    setLifecycle(markModulesPreviewing(initializeModuleLifecycle(orderedSelection)))
    setPreviews([])
    await requestPreview(orderedSelection.map((resource) => resource.key))
  }

  async function retryPreview(key: string) {
    setLifecycle((current) => markModulesPreviewing(current, [key]))
    await requestPreview([key])
  }

  async function runImport() {
    if (!source) return
    setLoading(true)
    setError(null)
    setBlockedSession(null)
    try {
      const selectedModules = orderedModules(lifecycle).map((entry) => ({ key: entry.key, label: entry.label, moduleKey: entry.moduleKey }))
      const sessionResponse = await fetch('/api/import-export/migration-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selectedModules,
          duplicateStrategy: strategy,
          lifecycle,
          sourceLabel: source.label,
          companyName: source.companyName,
          currency: source.baseCurrency,
        }),
      })
      if (sessionResponse.status === 409) {
        const conflict = await sessionResponse.json() as { session?: HydratedMigrationSession; error?: string }
        if (conflict.session) {
          setBlockedSession(conflict.session)
          setError('Migration already running')
          return
        }
        throw new Error(conflict.error ?? 'Migration already running')
      }
      if (!sessionResponse.ok) throw new Error(await readApiError(sessionResponse))
      const createdSession = await sessionResponse.json() as { session: HydratedMigrationSession }
      setSessionId(createdSession.session.id)
      sessionIdRef.current = createdSession.session.id
      setLifecycle(createdSession.session.lifecycle)
      window.dispatchEvent(new Event('quickbooks-migration-session-changed'))
      onClose()
      onSuccess?.(createdSession.session.id)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Migration failed.')
    } finally {
      setLoading(false)
    }
  }

  async function resumeBlockedSession() {
    if (!blockedSession) return
    const id = blockedSession.id
    setBlockedSession(null)
    window.dispatchEvent(new Event('quickbooks-migration-session-changed'))
    onClose()
    onSuccess?.(id)
  }

  async function cancelActiveMigration(targetSessionId?: string) {
    const id = targetSessionId ?? sessionIdRef.current ?? blockedSession?.id
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      resumeTokenRef.current += 1
      await onCancelSession(id)
      setBlockedSession(null)
      setSessionId(null)
      sessionIdRef.current = null
      setStep('import')
      setError('Migration cancelled.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to cancel the migration.')
    } finally {
      setLoading(false)
    }
  }

  async function downloadReport(format: 'pdf' | 'csv' | 'json') {
    if (!report) return
    const response = await fetch('/api/migration-wizard/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ format, report }) })
    if (!response.ok) return
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `migration-report.${format}`
    link.click()
    URL.revokeObjectURL(url)
  }

  const stageIndex = STAGES.findIndex((stage) => stage.key === step)
  const successfulPreviews = previews.filter(isPreviewSuccess)
  const duplicateCount = successfulPreviews.reduce((sum, item) => sum + item.duplicates.length, 0)
  const sourceRecordCount = successfulPreviews.reduce((sum, item) => sum + item.count, 0)
  const moduleKeys = source?.resources.map((resource) => resource.key) ?? []
  const allModulesSelected = moduleKeys.length > 0 && moduleKeys.every((key) => selected.includes(key))
  const lifecycleModules = useMemo(() => orderedModules(lifecycle), [lifecycle])
  const migrationStarted = useMemo(() => migrationHasStarted(lifecycle) || Boolean(sessionId), [lifecycle, sessionId])
  const readyModuleCount = lifecycleModules.filter((entry) => entry.phase === 'ready').length
  const showBlockedGate = Boolean(blockedSession)

  const footer = showBlockedGate ? (
    <>
      <Button variant="outline" onClick={() => void cancelActiveMigration(blockedSession?.id)}>Cancel Migration</Button>
      <Button loading={loading} onClick={() => void resumeBlockedSession()}>Resume Migration</Button>
    </>
  ) : step === 'report' ? (
    <Button onClick={close}>Close</Button>
  ) : (
    <>
      <Button variant="outline" onClick={close}>Cancel</Button>
      {step === 'analyze' && <Button disabled={!source?.connected || sessionBootstrapping} onClick={() => setStep('modules')}>Continue</Button>}
      {step === 'modules' && <><Button variant="outline" onClick={() => setStep('analyze')}>Back</Button><Button loading={loading} disabled={!selected.length} onClick={() => void preview()}>Validate Selected Modules</Button></>}
      {step === 'validation' && <><Button variant="outline" onClick={() => setStep('modules')}>Back</Button><Button disabled={readyModuleCount === 0} onClick={() => setStep('import')}>Continue to Import</Button></>}
      {step === 'import' && <><Button variant="outline" onClick={() => setStep('validation')} disabled={loading || migrationStarted}>Back</Button>{migrationStarted ? <Button variant="outline" loading={loading} onClick={() => void cancelActiveMigration()}>Cancel Migration</Button> : <Button loading={loading} disabled={readyModuleCount === 0} onClick={() => void runImport()}>Start Migration</Button>}</>}
    </>
  )

  return (
    <Modal open={open} onClose={close} title="Migration Wizard" subtitle={`Step ${stageIndex + 1} of ${STAGES.length} — ${STAGES[stageIndex]?.label ?? ''}`} size="2xl" footer={footer}>
      <div className="space-y-5">
        <div className="flex gap-2" aria-label="Migration stages">
          {STAGES.map((stage, index) => <div key={stage.key} title={stage.label} className={`h-1.5 flex-1 rounded-full ${index <= stageIndex ? 'bg-indigo-500' : 'bg-slate-200'}`} />)}
        </div>
        {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {loading && step !== 'import' && !showBlockedGate && <p className="flex items-center gap-2 text-sm text-slate-500"><RefreshCw size={14} className="animate-spin" /> Working…</p>}

        {showBlockedGate && blockedSession && (
          <div className="space-y-4 rounded-2xl border border-amber-200 bg-amber-50 p-5" data-migration-gate="already-running">
            <div>
              <h3 className="text-lg font-semibold text-amber-950">Migration already running</h3>
              <p className="mt-1 text-sm text-amber-900">A QuickBooks migration is already in progress for this company. Resume the existing session or cancel it before starting another.</p>
            </div>
            <ModuleLifecycleList modules={orderedModules(blockedSession.lifecycle)} busy={loading} />
            <div className="flex flex-wrap gap-2">
              <Button loading={loading} onClick={() => void resumeBlockedSession()}>Resume Migration</Button>
              <Button variant="outline" loading={loading} onClick={() => void cancelActiveMigration(blockedSession.id)}>Cancel Migration</Button>
            </div>
          </div>
        )}

        {!showBlockedGate && step === 'analyze' && (
          <div className="space-y-5">
            <div className="flex items-start gap-4 rounded-2xl border border-indigo-100 bg-indigo-50/60 p-5">
              <div className="rounded-xl bg-indigo-600 p-3 text-white"><Building2 size={22} /></div>
              <div><h3 className="font-semibold text-slate-900">Analyze Company</h3><p className="mt-1 text-sm leading-6 text-slate-600">Review the connected source and company identity before choosing what to migrate.</p></div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {sources.map((item) => <button key={item.key} type="button" onClick={() => item.connected && setSource(item)} disabled={!item.connected} className={`rounded-xl border p-4 text-left transition-colors ${source?.key === item.key ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200 hover:border-slate-300'} disabled:cursor-not-allowed disabled:opacity-50`}><div className="flex items-center gap-3"><PlugZap size={20} className="text-emerald-600" /><div><p className="font-semibold text-slate-800">{item.label}</p><p className="text-xs text-slate-500">{item.connected ? 'Connected and ready' : item.connectionStatus}</p></div></div></button>)}
            </div>
            {source?.connected && <>
              <dl className="grid grid-cols-2 gap-4 rounded-xl bg-slate-50 p-4 text-sm md:grid-cols-5"><div><dt className="text-xs text-slate-400">Company</dt><dd className="mt-1 font-medium text-slate-800">{analysis?.companyName ?? source.companyName ?? 'Connected company'}</dd></div><div><dt className="text-xs text-slate-400">Fiscal year</dt><dd className="mt-1 font-medium text-slate-800">{analysis?.fiscalYear ?? 'Not provided'}</dd></div><div><dt className="text-xs text-slate-400">Country</dt><dd className="mt-1 font-medium text-slate-800">{analysis?.country ?? source.country ?? '—'}</dd></div><div><dt className="text-xs text-slate-400">Currency</dt><dd className="mt-1 font-medium text-slate-800">{analysis?.currency ?? source.baseCurrency ?? '—'}</dd></div><div><dt className="text-xs text-slate-400">Estimated time</dt><dd className="mt-1 font-medium text-slate-800">{analysis ? `~${analysis.estimatedMigrationMinutes} min` : 'Calculating…'}</dd></div></dl>
              {analysis && <div className="space-y-4 rounded-2xl border border-slate-200 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold text-slate-900">Migration coverage</h3><span className="rounded-full bg-indigo-50 px-3 py-1 text-sm font-semibold text-indigo-700">{analysis.migrationCoveragePercent}%</span></div><div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-indigo-500" style={{ width: `${analysis.migrationCoveragePercent}%` }} /></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{analysis.recordCounts.map((item) => <div key={item.key} className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">{item.label}</p><p className="mt-1 text-lg font-semibold text-slate-900">{item.count.toLocaleString()}</p><p className="text-[11px] text-emerald-600">Supported</p></div>)}</div><div className="grid gap-4 md:grid-cols-2"><div><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-600">Supported modules</p><div className="flex flex-wrap gap-2">{analysis.supportedModules.map((item) => <span key={item} className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs text-emerald-700">{item}</span>)}</div></div><div><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Unsupported modules</p><div className="flex flex-wrap gap-2">{analysis.unsupportedModules.map((item) => <span key={item} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">{item}</span>)}</div></div></div></div>}
            </>}
          </div>
        )}

        {!showBlockedGate && step === 'modules' && source && <div className="space-y-4"><div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold text-slate-900">Select modules</h3><p className="mt-1 text-sm text-slate-500">Choose the records to fetch, validate, and migrate from {source.companyName ?? source.label}.</p></div><Button type="button" variant="outline" size="sm" onClick={toggleAllModules}>{allModulesSelected ? 'Unselect all' : 'Select all'}</Button></div><div className="grid gap-3 md:grid-cols-2">{source.resources.map((resource) => <label key={resource.key} className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 p-4 hover:bg-slate-50"><input type="checkbox" checked={selected.includes(resource.key)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, resource.key] : current.filter((key) => key !== resource.key))} className="h-4 w-4 rounded border-slate-300 text-indigo-600" /><Database size={18} className="text-indigo-500" /><span className="text-sm font-medium text-slate-700">{resource.label}</span></label>)}</div></div>}

        {!showBlockedGate && step === 'validation' && <div className="space-y-5"><div className="flex items-start gap-3 rounded-xl border border-emerald-100 bg-emerald-50 p-4"><FileCheck2 size={20} className="mt-0.5 text-emerald-600" /><div><h3 className="font-semibold text-emerald-900">Preview complete</h3><p className="mt-1 text-sm text-emerald-800">Counts come from QuickBooks; field validation uses the displayed sample. Full duplicate detection runs during import.</p></div></div><ModuleLifecycleList modules={lifecycleModules} onRetryPreview={(key) => void retryPreview(key)} busy={loading} />{previews.filter(isPreviewSuccess).map(renderPreviewResource)}</div>}

        {!showBlockedGate && step === 'import' && <div className="space-y-5">{loading ? <div className="py-12 text-center"><RefreshCw className="mx-auto mb-4 animate-spin text-indigo-500" /><p className="text-sm text-slate-600">Starting Migration Center…</p></div> : <><div className="flex items-start gap-3 rounded-xl border border-indigo-100 bg-indigo-50 p-4"><ShieldCheck size={20} className="mt-0.5 text-indigo-600" /><div><h3 className="font-semibold text-indigo-900">Ready to migrate</h3><p className="mt-1 text-sm text-indigo-800">{sourceRecordCount.toLocaleString()} source records will be extracted in the background. Preview samples are informational and are not reused. Select how existing records should be handled. After you start, progress continues in the Migration Center.</p></div></div><DuplicateStep duplicateCount={duplicateCount} strategy={strategy} onStrategyChange={setStrategy} /></>}<ModuleLifecycleList modules={lifecycleModules} onRetryPreview={(key) => void retryPreview(key)} busy={loading} /></div>}

        {!showBlockedGate && step === 'report' && totals && report && <div className="space-y-5"><ModuleLifecycleList modules={lifecycleModules} busy={loading} /><div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-5"><CheckCircle2 size={24} className="mt-0.5 text-emerald-600" /><div><h3 className="font-semibold text-emerald-900">Migration complete</h3><p className="mt-1 text-sm text-emerald-800">Your professional migration report is ready.</p></div></div><div className="grid grid-cols-2 gap-3 md:grid-cols-4">{([['Imported', totals.importedCount, 'text-emerald-700'], ['Updated', totals.updatedCount, 'text-blue-700'], ['Skipped', totals.skippedCount, 'text-amber-700'], ['Failed', totals.failedCount, 'text-red-700']] as const).map(([label, count, color]) => <div key={label} className="rounded-xl border border-slate-200 p-4 text-center"><p className="text-xs uppercase tracking-wide text-slate-400">{label}</p><p className={`mt-1 text-2xl font-bold ${color}`}>{count}</p></div>)}</div><div className="grid grid-cols-2 gap-3 md:grid-cols-4"><div className="rounded-xl bg-indigo-50 p-4"><p className="text-xs text-indigo-600">Validation score</p><p className="mt-1 text-2xl font-bold text-indigo-800">{report.validationScore}%</p></div><div className="rounded-xl bg-emerald-50 p-4"><p className="text-xs text-emerald-600">Integrity score</p><p className="mt-1 text-2xl font-bold text-emerald-800">{report.integrityScore}%</p></div><div className="rounded-xl bg-amber-50 p-4"><p className="text-xs text-amber-600">Warnings</p><p className="mt-1 text-2xl font-bold text-amber-800">{report.totals.warnings}</p></div><div className="rounded-xl bg-slate-100 p-4"><p className="text-xs text-slate-500">Duration</p><p className="mt-1 text-2xl font-bold text-slate-800">{(report.durationMs / 1000).toFixed(1)}s</p></div></div><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => void downloadReport('pdf')}>Export PDF</Button><Button variant="outline" onClick={() => void downloadReport('csv')}>Export CSV</Button><Button variant="outline" onClick={() => void downloadReport('json')}>Export JSON</Button></div><div className="space-y-2"><h3 className="text-sm font-semibold text-slate-800">Module report</h3>{report.modules.map((module) => <div key={module.key} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 px-4 py-3 text-sm"><span className="font-medium text-slate-700">{module.label}</span><span className="text-slate-500">{module.sourceCount} records · {module.importedCount} imported · {module.updatedCount} updated · {module.skippedCount} skipped · {module.failedCount} failed · {module.warningCount} warnings</span></div>)}</div></div>}
      </div>
    </Modal>
  )
}

function isPreviewSuccess(resource: PreviewResource): resource is PreviewSuccess {
  return resource.status === 'success'
}

function mergePreviews(current: PreviewResource[], incoming: PreviewResource[]): PreviewResource[] {
  const merged = current.filter((item) => !incoming.some((candidate) => candidate.key === item.key))
  return [...merged, ...incoming]
}

function renderPreviewResource(resource: PreviewSuccess) {
  return <section key={resource.key} className="rounded-xl border border-slate-200 p-4"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold text-slate-800">{resource.label}</h3><div className="flex flex-wrap gap-2 text-xs"><span className="rounded-full bg-slate-100 px-2.5 py-1">{resource.count.toLocaleString()} records</span><span className="rounded-full bg-indigo-50 px-2.5 py-1 text-indigo-700">{resource.sampleRows.length} sampled</span><span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-700">Duplicates checked during import</span><span className="rounded-full bg-red-50 px-2.5 py-1 text-red-700">{resource.validation.errorCount} sample errors</span></div></div><div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr className="bg-slate-50">{resource.headers.slice(0, 6).map((header) => <th key={header} className="px-2 py-2 text-left">{header}</th>)}</tr></thead><tbody>{resource.sampleRows.slice(0, 5).map((row, index) => <tr key={index} className="border-t">{resource.headers.slice(0, 6).map((header) => <td key={header} className="max-w-48 truncate px-2 py-2">{row[header] || '—'}</td>)}</tr>)}</tbody></table></div></section>
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`
}

const PHASE_TONE: Record<ModuleLifecyclePhase, string> = {
  selected: 'border-slate-200 bg-white',
  previewing: 'border-indigo-200 bg-indigo-50/50',
  ready: 'border-emerald-200 bg-emerald-50/40',
  unsupported: 'border-amber-200 bg-amber-50',
  preview_failed: 'border-red-200 bg-red-50',
  queued: 'border-slate-300 bg-slate-50',
  claimed: 'border-indigo-200 bg-indigo-50/40',
  processing: 'border-indigo-300 bg-indigo-50',
  paused: 'border-amber-200 bg-amber-50/60',
  completed: 'border-emerald-200 bg-emerald-50/40',
  completed_with_warnings: 'border-amber-200 bg-amber-50/50',
  failed: 'border-red-300 bg-red-50',
  cancelled: 'border-slate-300 bg-slate-100',
}

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

function PhaseBadge({ phase }: { phase: ModuleLifecyclePhase }) {
  return <span data-phase={phase} className={`rounded-full px-2.5 py-1 text-xs font-semibold ${PHASE_BADGE_TONE[phase]}`}>{MODULE_PHASE_LABEL[phase]}</span>
}

function ModuleLifecycleList({ modules, onRetryPreview, busy }: { modules: ModuleLifecycleEntry[]; onRetryPreview?: (key: string) => void; busy: boolean }) {
  if (modules.length === 0) return null
  return <section aria-label="Module lifecycle" className="space-y-3">
    <div className="flex items-center gap-2"><ListOrdered size={16} className="text-slate-400" /><h3 className="text-sm font-semibold text-slate-800">Selected modules ({modules.length})</h3></div>
    <div className="grid gap-3 md:grid-cols-2">{modules.map((entry) => <ModuleLifecycleCard key={entry.key} entry={entry} onRetryPreview={onRetryPreview} busy={busy} />)}</div>
  </section>
}

function ModuleLifecycleCard({ entry, onRetryPreview, busy }: { entry: ModuleLifecycleEntry; onRetryPreview?: (key: string) => void; busy: boolean }) {
  const percent = entry.phase === 'completed' || entry.phase === 'completed_with_warnings' ? 100 : Math.min(100, entry.progress?.progressPercent ?? 0)
  const showProgress = entry.progress !== null
  return <article data-module-key={entry.key} data-module-phase={entry.phase} className={`space-y-2 rounded-xl border p-4 ${PHASE_TONE[entry.phase]}`}>
    <header className="flex flex-wrap items-start justify-between gap-2">
      <div><h4 className="font-semibold text-slate-800">{entry.label}</h4><p className="text-[11px] uppercase tracking-wide text-slate-400">{entry.moduleKey}</p></div>
      <PhaseBadge phase={entry.phase} />
    </header>

    {entry.estimate && <p className="text-xs text-slate-600">{entry.estimate.records.toLocaleString()} estimated records · {entry.estimate.batches.toLocaleString()} batches · ~{formatDuration(entry.estimate.durationMs)} estimated{entry.preview?.countAccuracy === 'upper-bound' ? ' (upper bound)' : ''}</p>}
    {entry.preview && <p className="text-xs text-slate-500">{entry.preview.sampleRowCount} rows sampled · {entry.preview.sampleErrorCount} sample validation errors</p>}

    {entry.phase === 'unsupported' && entry.unsupported && <div className="space-y-1 rounded-lg bg-white/70 p-2">
      <p className="text-xs font-semibold text-amber-800">Unsupported</p>
      <p className="text-xs text-slate-700">{entry.unsupported.message}</p>
      {entry.unsupported.documentationUrl && <a href={entry.unsupported.documentationUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-indigo-700 underline">Documentation <ExternalLink size={12} /></a>}
    </div>}

    {entry.phase !== 'unsupported' && entry.failure && <div className="space-y-2 rounded-lg bg-white/70 p-2">
      <p className="text-xs font-semibold text-red-700">Failure reason</p>
      <p className="text-xs text-slate-700">{entry.failure.message}</p>
      {(entry.failure.stage || entry.failure.errorCode || entry.failure.correlationId) && <p className="text-[11px] text-slate-500">Provider response — stage: {entry.failure.stage ?? '—'} · code: {entry.failure.errorCode ?? '—'} · correlation: {entry.failure.correlationId ?? '—'}</p>}
      {entry.failure.retryable && onRetryPreview && <Button size="sm" variant="outline" disabled={busy} onClick={() => onRetryPreview(entry.key)}>Retry preview</Button>}
    </div>}

    {entry.queuePosition !== null && <p className="text-xs font-medium text-slate-600">Queue position {entry.queuePosition}</p>}

    {showProgress && entry.progress && <div className="space-y-2">
      <div className="h-1.5 overflow-hidden rounded-full bg-white"><div className={`h-full rounded-full ${entry.phase === 'failed' ? 'bg-red-500' : entry.phase === 'completed' || entry.phase === 'completed_with_warnings' ? 'bg-emerald-500' : 'bg-indigo-500'}`} style={{ width: `${percent}%` }} /></div>
      <p className="text-xs text-slate-600">{percent.toFixed(0)}% · {entry.progress.processedRows.toLocaleString()} / {entry.progress.totalRows.toLocaleString()} records · stage {entry.progress.currentStage?.replaceAll('_', ' ') ?? 'preparing'}</p>
      <p className="text-[11px] text-slate-500">{entry.progress.importedCount.toLocaleString()} imported · {entry.progress.updatedCount.toLocaleString()} updated · {entry.progress.skippedCount.toLocaleString()} skipped · {entry.progress.failedCount.toLocaleString()} failed{entry.warningCount > 0 ? ` · ${entry.warningCount.toLocaleString()} warnings` : ''}</p>
      <p className="text-[11px] text-slate-400">Elapsed {formatDuration(entry.progress.elapsedMs)}{entry.progress.estimatedRemainingSeconds !== null ? ` · ETA ${formatDuration(entry.progress.estimatedRemainingSeconds * 1000)}` : ''}{entry.progress.averageThroughput !== null ? ` · ${entry.progress.averageThroughput.toFixed(1)} rows/s` : ''}{entry.durationMs ? ` · finished in ${formatDuration(entry.durationMs)}` : ''}</p>
    </div>}
  </article>
}
