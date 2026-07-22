'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, HeartPulse, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { readApiError } from '@/lib/api-client'

interface HealthReport {
  scanId: string
  engineVersion: string
  overallScore: number
  categoryScores: Array<{
    category: string
    score: number
    findingCounts: Record<string, number>
  }>
  findings: Array<{
    checkId: string
    severity: string
    title: string
    detail: string
    recommendation: string
    entityType: string
  }>
  summary: Record<string, number>
  scannedAt: string
}

export default function DataHealthCenterPage() {
  const [report, setReport] = useState<HealthReport | null>(null)
  const [history, setHistory] = useState<Array<{ score: number; recorded_at: string }>>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function loadHistory() {
    const res = await fetch('/api/data-health/history')
    if (res.ok) {
      const data = await res.json()
      setHistory(data.history ?? [])
    }
  }

  useEffect(() => {
    loadHistory().catch(() => null)
  }, [])

  async function runScan() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/data-health/scans', { method: 'POST' })
      if (!res.ok) throw new Error(await readApiError(res))
      const data = await res.json()
      setReport(data.report)
      await loadHistory()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  const critical = report?.findings.filter((f) => f.severity === 'critical') ?? []

  return (
    <div className="space-y-6">
      <PageHeader
        title="Data Health Center"
        subtitle="Continuously monitor accounting data quality — recommendations only, no automatic changes"
        breadcrumb={[
          { label: 'Administration', href: '/settings' },
          { label: 'Production Readiness', href: '/settings/production-readiness' },
          { label: 'Data Health Center' },
        ]}
        action={
          <Button onClick={runScan} loading={loading}>
            <RefreshCw size={14} /> Run Health Scan
          </Button>
        }
      />

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:col-span-1">
          <div className="flex items-center gap-2 text-xs uppercase text-slate-400">
            <HeartPulse size={14} /> Data Health Score
          </div>
          <p className="mt-2 text-4xl font-bold text-sky-600">
            {report ? `${report.overallScore}%` : history[0] ? `${history[0].score}%` : '—'}
          </p>
          {report && (
            <p className="mt-1 text-xs text-slate-400">
              Engine {report.engineVersion} · {new Date(report.scannedAt).toLocaleString()}
            </p>
          )}
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:col-span-2">
          <h3 className="mb-3 text-sm font-semibold text-slate-900">Severity Summary</h3>
          {report ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {Object.entries(report.summary).map(([k, v]) => (
                <div key={k} className="rounded-lg bg-slate-50 px-3 py-2 text-center">
                  <div className="text-[10px] uppercase text-slate-400">{k}</div>
                  <div className="text-lg font-semibold">{v}</div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">Run a scan to see findings.</p>
          )}
        </div>
      </div>

      {critical.length > 0 && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5">
          <h3 className="mb-3 flex items-center gap-2 font-semibold text-rose-900">
            <AlertTriangle size={16} /> Critical Issues
          </h3>
          <ul className="space-y-2 text-sm text-rose-800">
            {critical.map((f, i) => (
              <li key={i}>
                <strong>{f.title}</strong> — {f.detail}
                <div className="text-xs text-rose-700">Recommendation: {f.recommendation}</div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {report && (
        <>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="mb-3 font-semibold">Category Scores</h3>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {report.categoryScores.map((c) => (
                <div key={c.category} className="rounded-lg border border-slate-100 px-3 py-2">
                  <div className="text-xs uppercase text-slate-400">{c.category.replace(/_/g, ' ')}</div>
                  <div className="text-xl font-semibold">{c.score}%</div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="mb-3 font-semibold">Findings & Recommendations</h3>
            <div className="max-h-96 space-y-3 overflow-y-auto">
              {report.findings.length === 0 && (
                <p className="text-sm text-slate-500">No issues detected.</p>
              )}
              {report.findings.map((f, i) => (
                <div key={i} className="rounded-lg border border-slate-100 p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{f.title}</span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase">
                      {f.severity}
                    </span>
                  </div>
                  <p className="mt-1 text-slate-600">{f.detail}</p>
                  <p className="mt-1 text-xs text-indigo-700">{f.recommendation}</p>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-3 font-semibold">Scan History</h3>
        <ul className="space-y-1 text-sm text-slate-600">
          {history.length === 0 && <li>No history yet.</li>}
          {history.slice(0, 12).map((h, i) => (
            <li key={i} className="flex justify-between">
              <span>{new Date(h.recorded_at).toLocaleString()}</span>
              <span className="font-medium">{h.score}%</span>
            </li>
          ))}
        </ul>
      </div>

      <Link href="/settings/production-readiness" className="text-sm text-indigo-600 hover:underline">
        ← Back to Production Readiness
      </Link>
    </div>
  )
}
