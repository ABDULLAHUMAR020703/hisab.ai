'use client'

import { useEffect, useState } from 'react'
import { CheckCircle2, Database, PlugZap } from 'lucide-react'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { readApiError } from '@/lib/api-client'
import type { DuplicateMatch, DuplicateStrategy, ValidationResult } from '@/lib/import-export/types'
import { DuplicateStep } from './DuplicateStep'

interface SourceResource { key: string; label: string; moduleKey: string }
interface ImportSource { key: string; label: string; connected: boolean; connectionStatus: string; resources: SourceResource[] }
interface PreviewResource extends SourceResource {
  count: number
  headers: string[]
  rows: Record<string, string>[]
  sampleRows: Record<string, string>[]
  mapping: Record<string, string>
  validation: ValidationResult
  duplicates: DuplicateMatch[]
}
interface ImportTotals { importedCount: number; updatedCount: number; skippedCount: number; failedCount: number }
type Step = 'source' | 'resources' | 'preview' | 'duplicates' | 'importing' | 'complete'

export function ConnectedSourceFlow({ open, onClose, onSuccess, initialSource }: {
  open: boolean
  onClose: () => void
  onSuccess?: () => void
  initialSource?: string
}) {
  const [step, setStep] = useState<Step>('source')
  const [sources, setSources] = useState<ImportSource[]>([])
  const [source, setSource] = useState<ImportSource | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [previews, setPreviews] = useState<PreviewResource[]>([])
  const [strategy, setStrategy] = useState<DuplicateStrategy>('skip')
  const [totals, setTotals] = useState<ImportTotals | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let active = true
    const timer = window.setTimeout(() => {
      setLoading(true)
      fetch('/api/import-export/sources', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error(await readApiError(response))
        return response.json() as Promise<ImportSource[]>
      })
      .then((items) => {
        if (!active) return
        setSources(items)
        const preferred = items.find((item) => item.key === initialSource && item.connected)
        if (preferred) setSource(preferred)
      })
      .catch((reason) => active && setError(reason instanceof Error ? reason.message : 'Unable to load import sources.'))
        .finally(() => active && setLoading(false))
    }, 0)
    return () => { active = false; window.clearTimeout(timer) }
  }, [initialSource, open])

  function close() {
    setStep('source'); setSource(null); setSelected([]); setPreviews([]); setStrategy('skip'); setTotals(null); setError(null)
    onClose()
  }

  async function preview() {
    if (!source || selected.length === 0) return
    setLoading(true); setError(null)
    try {
      const response = await fetch(`/api/import-export/sources/${source.key}/preview`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resources: selected }),
      })
      if (!response.ok) throw new Error(await readApiError(response))
      const payload = await response.json() as { resources: PreviewResource[] }
      setPreviews(payload.resources); setStep('preview')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to fetch provider data.')
    } finally { setLoading(false) }
  }

  async function runImport() {
    if (!source) return
    setStep('importing'); setLoading(true); setError(null)
    const summary: ImportTotals = { importedCount: 0, updatedCount: 0, skippedCount: 0, failedCount: 0 }
    try {
      for (const resource of previews) {
        const response = await fetch(`/api/import-export/${resource.moduleKey}/import`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rows: resource.rows,
            mapping: resource.mapping,
            filename: `${source.label} - ${resource.label}`,
            fileFormat: 'csv',
            duplicateStrategy: strategy,
            duplicates: resource.duplicates,
          }),
        })
        if (!response.ok) throw new Error(`${resource.label}: ${await readApiError(response)}`)
        const result = await response.json() as ImportTotals
        for (const key of Object.keys(summary) as Array<keyof ImportTotals>) summary[key] += result[key]
      }
      setTotals(summary); setStep('complete'); onSuccess?.()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Import failed.'); setStep('duplicates')
    } finally { setLoading(false) }
  }

  const order: Step[] = ['source', 'resources', 'preview', 'duplicates', 'importing', 'complete']
  const title = { source: 'Select Import Source', resources: 'Select Resources', preview: 'Preview Import', duplicates: 'Duplicate Strategy', importing: 'Importing', complete: 'Import Complete' }[step]
  const duplicateCount = previews.reduce((sum, item) => sum + item.duplicates.length, 0)

  const footer = step === 'complete' ? <Button onClick={close}>Close</Button> : <>
    <Button variant="outline" onClick={close}>Cancel</Button>
    {step === 'source' && <Button disabled={!source?.connected} onClick={() => setStep('resources')}>Continue</Button>}
    {step === 'resources' && <><Button variant="outline" onClick={() => setStep('source')}>Back</Button><Button loading={loading} disabled={!selected.length} onClick={() => void preview()}>Fetch & Preview</Button></>}
    {step === 'preview' && <><Button variant="outline" onClick={() => setStep('resources')}>Back</Button><Button disabled={!previews.some((item) => item.validation.validRowNumbers.length)} onClick={() => setStep('duplicates')}>Continue</Button></>}
    {step === 'duplicates' && <><Button variant="outline" onClick={() => setStep('preview')}>Back</Button><Button onClick={() => void runImport()}>Start Import</Button></>}
  </>

  return <Modal open={open} onClose={close} title="Import Data" subtitle={`Step ${Math.min(order.indexOf(step) + 1, 6)} of 6 — ${title}`} size="2xl" footer={footer}>
    <div className="space-y-5">
      <div className="flex gap-2">{order.slice(0, 5).map((item, index) => <div key={item} className={`h-1.5 flex-1 rounded-full ${index <= order.indexOf(step) ? 'bg-indigo-500' : 'bg-slate-200'}`} />)}</div>
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {loading && step !== 'importing' && <p className="text-sm text-slate-500">Loading…</p>}
      {step === 'source' && <div className="grid gap-3 md:grid-cols-2">{sources.map((item) => <button key={item.key} onClick={() => item.connected && setSource(item)} disabled={!item.connected} className={`rounded-xl border p-5 text-left ${source?.key === item.key ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200'} disabled:opacity-55`}><div className="flex items-center gap-3"><PlugZap className="text-emerald-600" size={22} /><div><p className="font-semibold text-slate-800">{item.label}</p><p className="text-xs text-slate-500">{item.connected ? 'Connected and ready' : `Connection: ${item.connectionStatus}`}</p></div></div></button>)}</div>}
      {step === 'resources' && source && <div className="grid gap-3 md:grid-cols-2">{source.resources.map((resource) => <label key={resource.key} className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 p-4"><input type="checkbox" checked={selected.includes(resource.key)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, resource.key] : current.filter((key) => key !== resource.key))} /><Database size={18} className="text-indigo-500" /><span className="text-sm font-medium">{resource.label}</span></label>)}</div>}
      {step === 'preview' && <div className="space-y-5">{previews.map((resource) => <section key={resource.key} className="rounded-xl border border-slate-200 p-4"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold text-slate-800">{resource.label}</h3><div className="flex gap-2 text-xs"><span className="rounded-full bg-slate-100 px-2.5 py-1">{resource.count} records</span><span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-700">{resource.duplicates.length} duplicates</span><span className="rounded-full bg-red-50 px-2.5 py-1 text-red-700">{resource.validation.errorCount} errors</span></div></div><div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr className="bg-slate-50">{resource.headers.slice(0, 6).map((header) => <th key={header} className="px-2 py-2 text-left">{header}</th>)}</tr></thead><tbody>{resource.sampleRows.slice(0, 5).map((row, index) => <tr key={index} className="border-t">{resource.headers.slice(0, 6).map((header) => <td key={header} className="max-w-48 truncate px-2 py-2">{row[header] || '—'}</td>)}</tr>)}</tbody></table></div></section>)}</div>}
      {step === 'duplicates' && <DuplicateStep duplicateCount={duplicateCount} strategy={strategy} onStrategyChange={setStrategy} />}
      {step === 'importing' && <div className="py-12 text-center"><div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" /><p className="text-sm text-slate-600">Importing selected resources…</p></div>}
      {step === 'complete' && totals && <div className="space-y-4"><div className="flex items-center gap-2 text-emerald-700"><CheckCircle2 size={20} /><span className="font-semibold">Provider import completed.</span></div><div className="grid grid-cols-2 gap-3 md:grid-cols-4">{([['Imported', totals.importedCount], ['Updated', totals.updatedCount], ['Skipped', totals.skippedCount], ['Failed', totals.failedCount]] as const).map(([label, count]) => <div key={label} className="rounded-xl border p-4 text-center"><p className="text-xs text-slate-400">{label}</p><p className="mt-1 text-2xl font-bold">{count}</p></div>)}</div></div>}
    </div>
  </Modal>
}
