'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, Lock, Shield } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import { readApiError } from '@/lib/api-client'

type Step = 'analyze' | 'dashboard' | 'decisions' | 'preview' | 'confirm' | 'done'

interface Finding {
  id: string
  entityType: string
  entityId: string
  label: string
  risk: string
  confidence: number
  confidenceFactors: { reason: string }[]
  recommendation: string
  canAct: boolean
  suggestedAction?: string
}

interface Analysis {
  score: number
  verdict: string
  checklist: Array<{
    id: string
    label: string
    status: string
    required: boolean
    fixHref?: string
    message?: string
  }>
  blocked: Array<{ id: string; label: string; message: string; fixHref?: string }>
  findings: Finding[]
  protectedSummary: Record<string, number>
  moduleCounts: Record<string, number>
  zatca: Record<string, unknown>
  openingBalanceMode: string
  wizardVersion: string
  detectionEngineVersion: string
}

const SCAN_LABELS = [
  'Scanning Company',
  'Scanning Customers',
  'Scanning Vendors',
  'Scanning Products/Services',
  'Scanning Cost Centers',
  'Scanning Invoices',
  'Checking Document Numbering',
  'Checking ZATCA Connection',
  'Checking Certificates',
]

export default function GoLiveWizardPage() {
  const [step, setStep] = useState<Step>('analyze')
  const [scanning, setScanning] = useState(false)
  const [scanProgress, setScanProgress] = useState(0)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null)
  const [result, setResult] = useState<Record<string, unknown> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmPhrase, setConfirmPhrase] = useState('')
  const [busy, setBusy] = useState(false)
  const [obAck, setObAck] = useState(false)

  const [selectedInvoices, setSelectedInvoices] = useState<Set<string>>(new Set())
  const [selectedCustomers, setSelectedCustomers] = useState<Set<string>>(new Set())
  const [selectedVendors, setSelectedVendors] = useState<Set<string>>(new Set())

  const actionable = useMemo(() => {
    const findings = analysis?.findings ?? []
    return {
      invoices: findings.filter(
        (f) => f.entityType === 'invoice' && f.canAct && f.risk !== 'PROTECTED',
      ),
      customers: findings.filter(
        (f) => f.entityType === 'customer' && f.canAct && f.suggestedAction === 'archive',
      ),
      vendors: findings.filter(
        (f) => f.entityType === 'vendor' && f.canAct && f.suggestedAction === 'archive',
      ),
      protected: findings.filter((f) => f.risk === 'PROTECTED'),
    }
  }, [analysis])

  async function runAnalyze() {
    setError(null)
    setScanning(true)
    setScanProgress(0)
    const timer = setInterval(() => {
      setScanProgress((p) => Math.min(p + 1, SCAN_LABELS.length - 1))
    }, 350)

    try {
      const res = await fetch('/api/go-live/analyze', { method: 'POST' })
      if (!res.ok) throw new Error(await readApiError(res))
      const data = await res.json()
      setSessionId(data.session.id)
      setAnalysis(data.analysis)

      const safeInvoiceIds = (data.analysis.findings as Finding[])
        .filter((f) => f.entityType === 'invoice' && f.risk === 'SAFE' && f.canAct)
        .map((f) => f.entityId)
      setSelectedInvoices(new Set(safeInvoiceIds))

      setStep('dashboard')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      clearInterval(timer)
      setScanning(false)
      setScanProgress(SCAN_LABELS.length)
    }
  }

  async function setOpeningBalanceZero() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/go-live/opening-balance-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'NEW_BUSINESS_ZERO', acknowledge: true }),
      })
      if (!res.ok) throw new Error(await readApiError(res))
      await runAnalyze()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function runPreview() {
    if (!sessionId) return
    setBusy(true)
    setError(null)
    try {
      const selection = {
        softDeleteInvoiceIds: [...selectedInvoices],
        archiveCustomerIds: [...selectedCustomers],
        archiveVendorIds: [...selectedVendors],
        archiveProductIds: [],
        archiveCostCenterIds: [],
        numbering: null,
        acknowledgeDashboardLive: true,
      }
      const res = await fetch('/api/go-live/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, selection }),
      })
      if (!res.ok) throw new Error(await readApiError(res))
      const data = await res.json()
      setPreview(data.preview)
      setStep('preview')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function runExecute() {
    if (!sessionId) return
    setBusy(true)
    setError(null)
    try {
      const selection = {
        softDeleteInvoiceIds: [...selectedInvoices],
        archiveCustomerIds: [...selectedCustomers],
        archiveVendorIds: [...selectedVendors],
        archiveProductIds: [],
        archiveCostCenterIds: [],
        numbering: null,
        acknowledgeDashboardLive: true,
      }
      const res = await fetch('/api/go-live/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          confirmPhrase,
          idempotencyKey: crypto.randomUUID(),
          selection,
        }),
      })
      if (!res.ok) throw new Error(await readApiError(res))
      const data = await res.json()
      setResult(data)
      setStep('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  function toggle(set: Set<string>, id: string, setter: (s: Set<string>) => void) {
    const next = new Set(set)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setter(next)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Go-Live Wizard"
        subtitle="Analyze, recommend, and execute only what you confirm"
        breadcrumb={[
          { label: 'Administration', href: '/settings' },
          { label: 'Production Readiness', href: '/settings/production-readiness' },
          { label: 'Go-Live Wizard' },
        ]}
      />

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      {step === 'analyze' && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Preparing Company for Go-Live…</h2>
          <p className="mt-1 text-sm text-slate-500">No changes are made during analysis.</p>
          <ul className="mt-6 space-y-2">
            {SCAN_LABELS.map((label, i) => (
              <li key={label} className="flex items-center gap-2 text-sm text-slate-700">
                <CheckCircle2
                  size={16}
                  className={i <= scanProgress && scanning ? 'text-emerald-500' : 'text-slate-300'}
                />
                {label}
              </li>
            ))}
          </ul>
          <div className="mt-6">
            <Button onClick={runAnalyze} loading={scanning}>
              Start Analysis
            </Button>
          </div>
        </div>
      )}

      {step === 'dashboard' && analysis && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-xs uppercase text-slate-400">Readiness Score</p>
                <p className="text-4xl font-bold text-slate-900">{analysis.score}%</p>
                <p className="mt-1 font-medium text-slate-600">{analysis.verdict}</p>
              </div>
              <div className="text-xs text-slate-400">
                Engine {analysis.detectionEngineVersion} · Wizard {analysis.wizardVersion}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="mb-3 flex items-center gap-2 font-semibold">
              <Shield size={16} className="text-emerald-600" /> ZATCA Status
            </h3>
            <div className="grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
              <div>✓ Environment: {String(analysis.zatca.environment ?? '—')}</div>
              <div>✓ Production CSID: {analysis.zatca.hasProductionCsid ? 'Present' : 'Missing'}</div>
              <div>✓ Compliance CSID: {analysis.zatca.hasComplianceCsid ? 'Present' : 'Missing'}</div>
              <div>✓ Certificate: {analysis.zatca.hasCertificate ? 'Present' : 'Missing'}</div>
            </div>
          </div>

          {analysis.blocked.length > 0 && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5">
              <h3 className="mb-3 font-semibold text-rose-900">Required — Blocked</h3>
              <ul className="space-y-2 text-sm text-rose-800">
                {analysis.blocked.map((b) => (
                  <li key={b.id} className="flex justify-between gap-2">
                    <span>
                      <strong>{b.label}</strong> — {b.message}
                    </span>
                    {b.fixHref && (
                      <Link href={b.fixHref} className="underline">
                        Fix Now
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
              {analysis.blocked.some((b) => b.id === 'accounting.opening_balances') && (
                <div className="mt-4 rounded-xl border border-rose-200 bg-white p-4">
                  <p className="text-sm font-medium text-slate-800">
                    Start New Business With Zero Opening Balances
                  </p>
                  <label className="mt-2 flex items-center gap-2 text-sm text-slate-600">
                    <input type="checkbox" checked={obAck} onChange={(e) => setObAck(e.target.checked)} />
                    I acknowledge this company will start with zero opening balances.
                  </label>
                  <Button
                    className="mt-3"
                    disabled={!obAck || busy}
                    loading={busy}
                    onClick={setOpeningBalanceZero}
                  >
                    Confirm Zero Opening Balances
                  </Button>
                </div>
              )}
            </div>
          )}

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="mb-3 font-semibold">Module Summary</h3>
            <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              {Object.entries(analysis.moduleCounts).map(([k, v]) => (
                <div key={k} className="rounded-lg bg-slate-50 px-3 py-2">
                  <div className="text-xs text-slate-400">{k}</div>
                  <div className="font-semibold">{v}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="mb-3 font-semibold">Recommended Findings</h3>
            <div className="max-h-80 space-y-3 overflow-y-auto">
              {analysis.findings
                .filter((f) => f.risk !== 'PROTECTED')
                .slice(0, 40)
                .map((f) => (
                  <div key={f.id} className="rounded-lg border border-slate-100 p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{f.label}</span>
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase">
                        {f.risk}
                      </span>
                      <span className="text-xs text-slate-400">Confidence {f.confidence}%</span>
                    </div>
                    <p className="mt-1 text-slate-600">{f.recommendation}</p>
                    {f.confidenceFactors?.length > 0 && (
                      <ul className="mt-2 list-inside list-disc text-xs text-slate-500">
                        {f.confidenceFactors.map((c, i) => (
                          <li key={i}>{c.reason}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
            </div>
          </div>

          <div className="flex gap-2">
            <Button onClick={() => setStep('decisions')}>Continue to Decisions</Button>
            <Button variant="ghost" onClick={() => setStep('analyze')}>
              Re-analyze
            </Button>
          </div>
        </div>
      )}

      {step === 'decisions' && analysis && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="mb-2 font-semibold">Transactional — Soft-delete invoices</h3>
            <p className="mb-3 text-xs text-slate-500">Protected ZATCA invoices cannot be selected.</p>
            <ul className="max-h-48 space-y-1 overflow-y-auto text-sm">
              {actionable.invoices.map((f) => (
                <li key={f.id}>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selectedInvoices.has(f.entityId)}
                      onChange={() => toggle(selectedInvoices, f.entityId, setSelectedInvoices)}
                    />
                    {f.label} <span className="text-xs text-slate-400">({f.risk})</span>
                  </label>
                </li>
              ))}
              {actionable.invoices.length === 0 && (
                <li className="text-slate-400">No actionable invoices.</li>
              )}
            </ul>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="mb-2 font-semibold">Master Data — Archive customers</h3>
            <ul className="max-h-40 space-y-1 overflow-y-auto text-sm">
              {actionable.customers.map((f) => (
                <li key={f.id}>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selectedCustomers.has(f.entityId)}
                      onChange={() => toggle(selectedCustomers, f.entityId, setSelectedCustomers)}
                    />
                    {f.label}
                  </label>
                </li>
              ))}
              {actionable.customers.length === 0 && (
                <li className="text-slate-400">No archive candidates.</li>
              )}
            </ul>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="mb-2 font-semibold">Master Data — Archive vendors</h3>
            <ul className="max-h-40 space-y-1 overflow-y-auto text-sm">
              {actionable.vendors.map((f) => (
                <li key={f.id}>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selectedVendors.has(f.entityId)}
                      onChange={() => toggle(selectedVendors, f.entityId, setSelectedVendors)}
                    />
                    {f.label}
                  </label>
                </li>
              ))}
              {actionable.vendors.length === 0 && (
                <li className="text-slate-400">No archive candidates.</li>
              )}
            </ul>
          </div>

          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <div className="mb-1 flex items-center gap-2 font-semibold">
              <Lock size={14} /> Protected
            </div>
            {analysis.protectedSummary.invoices ?? 0} submitted/cleared/reported invoices cannot be
            removed. ZATCA credentials are never modified.
          </div>

          <div className="flex gap-2">
            <Button onClick={runPreview} loading={busy}>
              Dry-Run Preview
            </Button>
            <Button variant="ghost" onClick={() => setStep('dashboard')}>
              Back
            </Button>
          </div>
        </div>
      )}

      {step === 'preview' && preview && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="mb-3 font-semibold">Execution Plan (no changes yet)</h3>
            <pre className="overflow-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-700">
              {JSON.stringify(preview, null, 2)}
            </pre>
            {!(preview as { canExecute?: boolean }).canExecute && (
              <p className="mt-3 text-sm text-rose-600">
                Cannot execute until blockers are resolved.
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              disabled={!(preview as { canExecute?: boolean }).canExecute}
              onClick={() => setStep('confirm')}
            >
              Continue to Confirm
            </Button>
            <Button variant="ghost" onClick={() => setStep('decisions')}>
              Back
            </Button>
          </div>
        </div>
      )}

      {step === 'confirm' && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="font-semibold text-slate-900">Final Confirmation</h3>
          <p className="mt-2 text-sm text-slate-600">
            Type <strong>GO LIVE</strong> to execute only the selected actions. Soft-deleted
            transactions and archived master data will update. ZATCA credentials stay untouched.
            Dashboard values recalculate from remaining live data on next load.
          </p>
          <div className="mt-4 max-w-sm">
            <Input
              label="Confirmation"
              value={confirmPhrase}
              onChange={(e) => setConfirmPhrase(e.target.value)}
              placeholder="GO LIVE"
            />
          </div>
          <div className="mt-4 flex gap-2">
            <Button
              loading={busy}
              disabled={confirmPhrase !== 'GO LIVE'}
              onClick={runExecute}
            >
              Execute Go-Live
            </Button>
            <Button variant="ghost" onClick={() => setStep('preview')}>
              Back
            </Button>
          </div>
        </div>
      )}

      {step === 'done' && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6">
          <h3 className="text-lg font-semibold text-emerald-900">Production Ready</h3>
          <ul className="mt-3 space-y-1 text-sm text-emerald-800">
            <li>✓ Company configuration reviewed</li>
            <li>✓ Selected hygiene actions executed</li>
            <li>✓ ZATCA credentials preserved</li>
            <li>✓ Dashboard reflects remaining data on next load</li>
          </ul>
          <pre className="mt-4 overflow-auto rounded-lg bg-white/80 p-3 text-xs text-slate-700">
            {JSON.stringify(result, null, 2)}
          </pre>
          <div className="mt-4">
            <Link href="/settings/production-readiness">
              <Button>Back to Production Readiness</Button>
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
