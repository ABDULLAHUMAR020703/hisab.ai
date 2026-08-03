'use client'

import { useEffect, useState } from 'react'
import { Building2, CheckCircle2, Database, FileCheck2, PlugZap, RefreshCw, ShieldCheck } from 'lucide-react'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { readApiError } from '@/lib/api-client'
import type { DuplicateMatch, DuplicateStrategy, ValidationResult } from '@/lib/import-export/types'
import { DuplicateStep } from './DuplicateStep'
import { buildMigrationReport, type MigrationReport } from '@/lib/import-export/migration-report'
import { orderQuickBooksMigrationResources } from '@/lib/import-export/quickbooks/dependency-order'

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
interface ImportResult extends ImportTotals {
  jobId: string
  status: string
  totalRows: number
  validRows?: number | null
  invalidRows?: number | null
  warningCount?: number | null
  durationMs?: number
  errors?: import('@/lib/import-export/types').ImportRowError[]
}
interface JobProgress {
  module: string
  status: string
  currentBatch: number
  processedRows: number
  estimatedRemaining: number | null
}
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

export function ConnectedSourceFlow({ open, onClose, onSuccess, initialSource }: {
  open: boolean
  onClose: () => void
  onSuccess?: () => void
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
  const [jobProgress, setJobProgress] = useState<JobProgress | null>(null)

  useEffect(() => {
    if (!open) return
    let active = true
    const timer = window.setTimeout(() => {
      setLoading(true)
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
      }).then(({ items, analysis: analysisPayload }) => {
        if (!active) return
        setSources(items)
        setAnalysis(analysisPayload)
        const preferred = items.find((item) => item.key === initialSource && item.connected)
        setSource(preferred ?? items.find((item) => item.connected) ?? null)
      })
      .catch((reason) => active && setError(reason instanceof Error ? reason.message : 'Unable to analyze the company.'))
      .finally(() => active && setLoading(false))
    }, 0)
    return () => { active = false; window.clearTimeout(timer) }
  }, [initialSource, open])

  function close() {
    setStep('analyze')
    setSource(null)
    setAnalysis(null)
    setSelected([])
    setPreviews([])
    setStrategy('skip')
    setTotals(null)
    setReport(null)
    setJobProgress(null)
    setError(null)
    onClose()
  }

  function toggleAllModules() {
    const moduleKeys = source?.resources.map((resource) => resource.key) ?? []
    setSelected((current) => moduleKeys.length > 0 && moduleKeys.every((key) => current.includes(key)) ? [] : moduleKeys)
  }

  async function preview() {
    if (!source || selected.length === 0) return
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/import-export/sources/${source.key}/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resources: selected }),
      })
      if (!response.ok) throw new Error(await readApiError(response))
      const payload = await response.json() as { resources: PreviewResource[] }
      setPreviews(payload.resources)
      setStep('validation')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to validate source data.')
    } finally {
      setLoading(false)
    }
  }

  async function runImport() {
    if (!source) return
    setLoading(true)
    setError(null)
    const summary: ImportTotals = { importedCount: 0, updatedCount: 0, skippedCount: 0, failedCount: 0 }
    const startedAt = Date.now()
    const moduleReports: MigrationReport['modules'] = []
    try {
      const queued: Array<{ resource: PreviewSuccess; jobId: string }> = []
      for (const resource of orderQuickBooksMigrationResources(previews.filter(isPreviewSuccess))) {
        const response = await fetch(`/api/import-export/${resource.moduleKey}/import`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            background: true,
            sourceKey: source.key,
            resourceKey: resource.key,
            filename: `${source.label} - ${resource.label}`,
            fileFormat: 'csv',
            duplicateStrategy: strategy,
          }),
        })
        if (!response.ok) throw new Error(`${resource.label}: ${await readApiError(response)}`)
        const created = await response.json() as { jobId?: string }
        if (!created.jobId) throw new Error(`${resource.label}: migration job did not return an identifier`)
        queued.push({ resource, jobId: created.jobId })
      }

      for (const { resource, jobId } of queued) {
        const response = await fetch(`/api/import-export/jobs/${jobId}/run`, { method: 'POST' })
        if (!response.ok) throw new Error(`${resource.label}: ${await readApiError(response)}`)
        let result = await response.json() as ImportResult
        while (result.status === 'pending' || result.status === 'processing') {
          const progressResponse = await fetch(`/api/import-export/jobs/${jobId}`, { cache: 'no-store' })
          if (!progressResponse.ok) throw new Error(`${resource.label}: ${await readApiError(progressResponse)}`)
          const progress = await progressResponse.json() as JobProgress & ImportResult
          setJobProgress({ module: resource.label, status: progress.status, currentBatch: progress.currentBatch, processedRows: progress.processedRows, estimatedRemaining: progress.estimatedRemaining })
          if (progress.status === 'pending' || progress.status === 'processing') {
            await new Promise((resolve) => window.setTimeout(resolve, 1500))
          }
          result = progress
        }
        setJobProgress(null)
        if (result.status !== 'completed') throw new Error(`${resource.label}: migration job ended with status ${result.status}`)
        for (const key of Object.keys(summary) as Array<keyof ImportTotals>) summary[key] += result[key]
        moduleReports.push({ key: resource.key, label: resource.label, sourceCount: result.totalRows, validCount: result.validRows ?? Math.max(0, result.totalRows - (result.invalidRows ?? 0)), warningCount: result.warningCount ?? 0, validationErrors: result.invalidRows ?? 0, importedCount: result.importedCount, updatedCount: result.updatedCount, skippedCount: result.skippedCount, failedCount: result.failedCount, durationMs: result.durationMs ?? 0, errors: result.errors })
      }
      setTotals(summary)
      setReport(buildMigrationReport({ source: source.label, companyName: source.companyName, currency: source.baseCurrency, durationMs: Date.now() - startedAt, modules: moduleReports }))
      setStep('report')
      onSuccess?.()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Migration failed.')
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

  const footer = step === 'report' ? (
    <Button onClick={close}>Close</Button>
  ) : (
    <>
      <Button variant="outline" onClick={close}>Cancel</Button>
      {step === 'analyze' && <Button disabled={!source?.connected} onClick={() => setStep('modules')}>Continue</Button>}
      {step === 'modules' && <><Button variant="outline" onClick={() => setStep('analyze')}>Back</Button><Button loading={loading} disabled={!selected.length} onClick={() => void preview()}>Validate Selected Modules</Button></>}
      {step === 'validation' && <><Button variant="outline" onClick={() => setStep('modules')}>Back</Button><Button disabled={successfulPreviews.length === 0} onClick={() => setStep('import')}>Continue to Import</Button></>}
      {step === 'import' && <><Button variant="outline" onClick={() => setStep('validation')} disabled={loading}>Back</Button><Button loading={loading} disabled={successfulPreviews.length === 0} onClick={() => void runImport()}>Start Migration</Button></>}
    </>
  )

  return (
    <Modal open={open} onClose={close} title="Migration Wizard" subtitle={`Step ${stageIndex + 1} of ${STAGES.length} — ${STAGES[stageIndex]?.label ?? ''}`} size="2xl" footer={footer}>
      <div className="space-y-5">
        <div className="flex gap-2" aria-label="Migration stages">
          {STAGES.map((stage, index) => <div key={stage.key} title={stage.label} className={`h-1.5 flex-1 rounded-full ${index <= stageIndex ? 'bg-indigo-500' : 'bg-slate-200'}`} />)}
        </div>
        {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {loading && step !== 'import' && <p className="flex items-center gap-2 text-sm text-slate-500"><RefreshCw size={14} className="animate-spin" /> Working…</p>}

        {step === 'analyze' && (
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

        {step === 'modules' && source && <div className="space-y-4"><div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold text-slate-900">Select modules</h3><p className="mt-1 text-sm text-slate-500">Choose the records to fetch, validate, and migrate from {source.companyName ?? source.label}.</p></div><Button type="button" variant="outline" size="sm" onClick={toggleAllModules}>{allModulesSelected ? 'Unselect all' : 'Select all'}</Button></div><div className="grid gap-3 md:grid-cols-2">{source.resources.map((resource) => <label key={resource.key} className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 p-4 hover:bg-slate-50"><input type="checkbox" checked={selected.includes(resource.key)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, resource.key] : current.filter((key) => key !== resource.key))} className="h-4 w-4 rounded border-slate-300 text-indigo-600" /><Database size={18} className="text-indigo-500" /><span className="text-sm font-medium text-slate-700">{resource.label}</span></label>)}</div></div>}

        {step === 'validation' && <div className="space-y-5"><div className="flex items-start gap-3 rounded-xl border border-emerald-100 bg-emerald-50 p-4"><FileCheck2 size={20} className="mt-0.5 text-emerald-600" /><div><h3 className="font-semibold text-emerald-900">Preview complete</h3><p className="mt-1 text-sm text-emerald-800">Counts come from QuickBooks; field validation uses the displayed sample. Full duplicate detection runs during import.</p></div></div>{previews.map(renderPreviewResource)}</div>}

        {step === 'import' && <div className="space-y-5">{loading ? <div className="py-12 text-center"><div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" /><p className="text-sm text-slate-600">Running bounded background migration units…</p>{jobProgress && <p className="mt-3 text-xs text-slate-500">{jobProgress.module} · batch {jobProgress.currentBatch} · {jobProgress.processedRows.toLocaleString()} records processed · {jobProgress.estimatedRemaining === null ? 'remaining work is being calculated' : `${jobProgress.estimatedRemaining.toLocaleString()} estimated remaining`}</p>}</div> : <><div className="flex items-start gap-3 rounded-xl border border-indigo-100 bg-indigo-50 p-4"><ShieldCheck size={20} className="mt-0.5 text-indigo-600" /><div><h3 className="font-semibold text-indigo-900">Ready to migrate</h3><p className="mt-1 text-sm text-indigo-800">{sourceRecordCount.toLocaleString()} source records will be extracted in the background. Preview samples are informational and are not reused. Select how existing records should be handled.</p></div></div><DuplicateStep duplicateCount={duplicateCount} strategy={strategy} onStrategyChange={setStrategy} /></>}</div>}

        {step === 'report' && totals && report && <div className="space-y-5"><div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-5"><CheckCircle2 size={24} className="mt-0.5 text-emerald-600" /><div><h3 className="font-semibold text-emerald-900">Migration complete</h3><p className="mt-1 text-sm text-emerald-800">Your professional migration report is ready.</p></div></div><div className="grid grid-cols-2 gap-3 md:grid-cols-4">{([['Imported', totals.importedCount, 'text-emerald-700'], ['Updated', totals.updatedCount, 'text-blue-700'], ['Skipped', totals.skippedCount, 'text-amber-700'], ['Failed', totals.failedCount, 'text-red-700']] as const).map(([label, count, color]) => <div key={label} className="rounded-xl border border-slate-200 p-4 text-center"><p className="text-xs uppercase tracking-wide text-slate-400">{label}</p><p className={`mt-1 text-2xl font-bold ${color}`}>{count}</p></div>)}</div><div className="grid grid-cols-2 gap-3 md:grid-cols-4"><div className="rounded-xl bg-indigo-50 p-4"><p className="text-xs text-indigo-600">Validation score</p><p className="mt-1 text-2xl font-bold text-indigo-800">{report.validationScore}%</p></div><div className="rounded-xl bg-emerald-50 p-4"><p className="text-xs text-emerald-600">Integrity score</p><p className="mt-1 text-2xl font-bold text-emerald-800">{report.integrityScore}%</p></div><div className="rounded-xl bg-amber-50 p-4"><p className="text-xs text-amber-600">Warnings</p><p className="mt-1 text-2xl font-bold text-amber-800">{report.totals.warnings}</p></div><div className="rounded-xl bg-slate-100 p-4"><p className="text-xs text-slate-500">Duration</p><p className="mt-1 text-2xl font-bold text-slate-800">{(report.durationMs / 1000).toFixed(1)}s</p></div></div><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => void downloadReport('pdf')}>Export PDF</Button><Button variant="outline" onClick={() => void downloadReport('csv')}>Export CSV</Button><Button variant="outline" onClick={() => void downloadReport('json')}>Export JSON</Button></div><div className="space-y-2"><h3 className="text-sm font-semibold text-slate-800">Module report</h3>{report.modules.map((module) => <div key={module.key} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 px-4 py-3 text-sm"><span className="font-medium text-slate-700">{module.label}</span><span className="text-slate-500">{module.sourceCount} records · {module.importedCount} imported · {module.updatedCount} updated · {module.skippedCount} skipped · {module.failedCount} failed · {module.warningCount} warnings</span></div>)}</div></div>}
      </div>
    </Modal>
  )
}

function isPreviewSuccess(resource: PreviewResource): resource is PreviewSuccess {
  return resource.status === 'success'
}

function renderPreviewResource(resource: PreviewResource) {
  if (resource.status !== 'success') {
    const tone = resource.status === 'unsupported' ? 'border-amber-200 bg-amber-50' : 'border-red-200 bg-red-50'
    return <section key={resource.key} className={`rounded-xl border p-4 ${tone}`}>
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold text-slate-800">{resource.label}</h3><span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-700">{resource.status}</span></div>
      <p className="mt-2 text-sm text-slate-700">{resource.message}</p>
      <p className="mt-2 text-xs text-slate-500">Stage: {resource.stage} · Code: {resource.errorCode} · Correlation: {resource.correlationId}</p>
    </section>
  }
  return <section key={resource.key} className="rounded-xl border border-slate-200 p-4"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold text-slate-800">{resource.label}</h3><div className="flex flex-wrap gap-2 text-xs"><span className="rounded-full bg-slate-100 px-2.5 py-1">{resource.count.toLocaleString()} records</span><span className="rounded-full bg-indigo-50 px-2.5 py-1 text-indigo-700">{resource.sampleRows.length} sampled</span><span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-700">Duplicates checked during import</span><span className="rounded-full bg-red-50 px-2.5 py-1 text-red-700">{resource.validation.errorCount} sample errors</span></div></div><div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr className="bg-slate-50">{resource.headers.slice(0, 6).map((header) => <th key={header} className="px-2 py-2 text-left">{header}</th>)}</tr></thead><tbody>{resource.sampleRows.slice(0, 5).map((row, index) => <tr key={index} className="border-t">{resource.headers.slice(0, 6).map((header) => <td key={header} className="max-w-48 truncate px-2 py-2">{row[header] || '—'}</td>)}</tr>)}</tbody></table></div></section>
}
