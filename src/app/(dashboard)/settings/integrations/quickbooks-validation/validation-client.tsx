'use client'

import { useState } from 'react'
import { AlertCircle, CheckCircle2, Download, Loader2, Play, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { readApiError } from '@/lib/api-client'
import { validationReportToCsv } from '@/lib/quickbooks-validation/engine'
import {
  QUICKBOOKS_VALIDATION_MODULES,
  type QuickBooksValidationModule,
  type QuickBooksValidationReport,
} from '@/lib/quickbooks-validation/types'

const LABELS: Partial<Record<QuickBooksValidationModule, string>> = {
  accounts: 'Chart of Accounts',
  customers: 'Customers',
  vendors: 'Vendors',
  items: 'Products & Services',
  'tax-codes': 'Tax Codes',
  'payment-terms': 'Payment Terms',
  invoices: 'Invoices',
  bills: 'Bills',
  'journal-entries': 'Journal Entries',
  expenses: 'Expenses',
}

function download(filename: string, contents: string, type: string) {
  const url = URL.createObjectURL(new Blob([contents], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export function QuickBooksValidationClient() {
  const [selected, setSelected] = useState<QuickBooksValidationModule[]>([...QUICKBOOKS_VALIDATION_MODULES])
  const [report, setReport] = useState<QuickBooksValidationReport | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setRunning(true)
    setError(null)
    setReport(null)
    try {
      const response = await fetch('/api/integrations/quickbooks/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modules: selected }),
      })
      if (!response.ok) throw new Error(await readApiError(response))
      setReport(await response.json() as QuickBooksValidationReport)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Validation could not be completed.')
    } finally {
      setRunning(false)
    }
  }

  const stamp = report?.generatedAt.slice(0, 19).replace(/[:T]/g, '-')
  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-semibold text-slate-900">Modules to validate</h2>
            <p className="mt-1 text-xs text-slate-500">Live source data is fetched when the run starts.</p>
          </div>
          <Button onClick={() => void run()} loading={running} disabled={selected.length === 0}>
            <Play size={14} /> Run validation
          </Button>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {QUICKBOOKS_VALIDATION_MODULES.map((module) => (
            <label key={module} className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 p-4 text-sm font-medium text-slate-700 hover:bg-slate-50">
              <input
                type="checkbox"
                checked={selected.includes(module)}
                onChange={(event) => setSelected((current) => event.target.checked ? [...current, module] : current.filter((item) => item !== module))}
                className="h-4 w-4 rounded border-slate-300 text-indigo-600"
              />
              {LABELS[module] ?? module.replaceAll('-', ' ').replace(/\b\w/g, letter => letter.toUpperCase())}
            </label>
          ))}
        </div>
      </section>

      {running && (
        <div className="flex items-center justify-center gap-3 rounded-2xl border border-indigo-100 bg-indigo-50 py-12 text-sm font-medium text-indigo-700">
          <Loader2 size={20} className="animate-spin" /> Fetching and comparing live records…
        </div>
      )}
      {error && <div role="alert" className="flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"><AlertCircle size={18} className="shrink-0" />{error}</div>}

      {report && (
        <>
          <section className={`rounded-2xl border p-6 ${report.passed ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50'}`}>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                {report.passed ? <CheckCircle2 className="text-emerald-600" size={28} /> : <XCircle className="text-red-600" size={28} />}
                <div>
                  <h2 className={`font-semibold ${report.passed ? 'text-emerald-900' : 'text-red-900'}`}>Validation {report.passed ? 'passed' : 'failed'}</h2>
                  <p className="mt-0.5 text-xs text-slate-600">{report.totals.matchedCount}/{report.totals.sourceCount} matched · {report.totals.issueCount} issues · Realm {report.realmId}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => download(`quickbooks-validation-${stamp}.json`, JSON.stringify(report, null, 2), 'application/json')}><Download size={14} /> JSON</Button>
                <Button variant="outline" onClick={() => download(`quickbooks-validation-${stamp}.csv`, validationReportToCsv(report), 'text/csv;charset=utf-8')}><Download size={14} /> CSV</Button>
              </div>
            </div>
          </section>

          <div className="grid gap-4 md:grid-cols-2">
            {report.modules.map((module) => (
              <section key={module.module} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-slate-900">{module.label}</h3>
                  {module.passed ? <CheckCircle2 size={18} className="text-emerald-500" /> : <XCircle size={18} className="text-red-500" />}
                </div>
                <div className="mt-4 space-y-1.5 text-sm">
                  <p className="text-emerald-700">✓ {module.matchedCount}/{module.sourceCount} matched</p>
                  {module.missingCount > 0 && <p className="text-red-700">✕ {module.missingCount} missing</p>}
                  {module.extraCount > 0 && <p className="text-red-700">✕ {module.extraCount} extra</p>}
                  {module.duplicateCount > 0 && <p className="text-red-700">✕ {module.duplicateCount} duplicates</p>}
                  {module.mismatchCount > 0 && <p className="text-red-700">✕ {module.mismatchCount} mismatched fields</p>}
                </div>
              </section>
            ))}
          </div>

          {report.modules.some((module) => module.issues.length > 0) && (
            <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-6 py-4"><h2 className="font-semibold text-slate-900">Mismatch details</h2></div>
              <div className="divide-y divide-slate-100">
                {report.modules.flatMap((module) => module.issues.map((issue, index) => (
                  <article key={`${module.module}-${issue.key}-${issue.field ?? issue.kind}-${index}`} className="p-6">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{module.label} · {issue.kind.replace(/_/g, ' ')}</p><h3 className="mt-1 font-semibold text-slate-900">{issue.recordName}</h3></div>
                      {issue.quickBooksId && <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-500">QB ID {issue.quickBooksId}</span>}
                    </div>
                    {issue.field && (
                      <div className="mt-4 grid gap-3 md:grid-cols-2">
                        <div className="rounded-xl bg-slate-50 p-4"><p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">QuickBooks · {issue.field}</p><p className="mt-1 break-words text-sm font-medium text-slate-800">{issue.quickBooksValue === null ? 'null' : String(issue.quickBooksValue)}</p></div>
                        <div className="rounded-xl bg-red-50 p-4"><p className="text-[10px] font-semibold uppercase tracking-wide text-red-400">Hisab AI · {issue.field}</p><p className="mt-1 break-words text-sm font-medium text-red-800">{issue.hisabValue === null ? 'null' : String(issue.hisabValue)}</p></div>
                      </div>
                    )}
                    <p className="mt-3 text-xs text-slate-500">{issue.message}</p>
                  </article>
                )))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
