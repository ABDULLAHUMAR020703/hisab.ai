'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Activity, ArrowRight, CheckCircle2, AlertTriangle, Rocket, HeartPulse } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { readApiError } from '@/lib/api-client'

interface ChecklistItem {
  id: string
  label: string
  status: 'complete' | 'incomplete' | 'blocked'
  required: boolean
  fixHref?: string
  message?: string
}

interface HubData {
  readiness: {
    score: number
    verdict: string
    checklist: ChecklistItem[]
    blocked: Array<{ id: string; label: string; message: string; fixHref?: string }>
    history: Array<{ score: number; verdict: string; recorded_at: string }>
    openingBalanceMode: string
  }
  dataHealth: {
    score: number | null
    lastScannedAt: string | null
    history: Array<{ score: number; recorded_at: string }>
  }
  productionLive: {
    productionLiveAt: string | null
  }
}

function ScoreRing({ score, label, tone }: { score: number | null; label: string; tone: 'ready' | 'health' }) {
  const value = score ?? 0
  const color =
    tone === 'ready'
      ? value >= 90
        ? 'text-emerald-600'
        : value >= 70
          ? 'text-amber-600'
          : 'text-rose-600'
      : value >= 90
        ? 'text-sky-600'
        : value >= 70
          ? 'text-amber-600'
          : 'text-rose-600'

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-2 text-4xl font-bold tabular-nums ${color}`}>
        {score === null ? '—' : `${score}%`}
      </p>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full rounded-full ${tone === 'ready' ? 'bg-emerald-500' : 'bg-sky-500'}`}
          style={{ width: `${score ?? 0}%` }}
        />
      </div>
    </div>
  )
}

export default function ProductionReadinessHubPage() {
  const [data, setData] = useState<HubData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    fetch('/api/settings/production-readiness')
      .then(async (r) => {
        if (!r.ok) throw new Error(await readApiError(r))
        return r.json()
      })
      .then((d) => {
        if (active) setData(d)
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  if (loading) {
    return <div className="p-6 text-slate-500">Loading production readiness…</div>
  }

  if (error || !data) {
    return <div className="p-6 text-rose-600">{error ?? 'Failed to load'}</div>
  }

  const verdict = data.readiness.verdict

  return (
    <div className="space-y-6">
      <PageHeader
        title="Production Readiness"
        subtitle="Prepare for go-live and continuously monitor data health"
        breadcrumb={[
          { label: 'Administration', href: '/settings' },
          { label: 'Settings', href: '/settings' },
          { label: 'Production Readiness' },
        ]}
      />

      {data.productionLive.productionLiveAt && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <CheckCircle2 size={16} />
          Production Live since{' '}
          {new Date(data.productionLive.productionLiveAt).toLocaleDateString()}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <ScoreRing score={data.readiness.score} label="Production Readiness" tone="ready" />
        <ScoreRing score={data.dataHealth.score} label="Data Health" tone="health" />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">Verdict</p>
            <p
              className={`mt-1 text-lg font-bold ${
                verdict === 'Ready'
                  ? 'text-emerald-600'
                  : verdict === 'Blocked'
                    ? 'text-rose-600'
                    : 'text-amber-600'
              }`}
            >
              {verdict === 'Blocked'
                ? 'Blocked — required items must be fixed'
                : verdict === 'Ready'
                  ? 'Ready for Go-Live'
                  : 'Needs Attention'}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Percentage measures progress. Blocked means you cannot go live until required items are fixed.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <Rocket size={18} className="text-indigo-600" />
            <h2 className="font-semibold text-slate-900">Go-Live Wizard</h2>
          </div>
          <p className="mb-4 text-sm text-slate-500">
            Analyze setup, review recommendations, and execute only what you confirm.
          </p>
          <Link href="/settings/production-readiness/go-live">
            <Button>
              Start Go-Live Wizard <ArrowRight size={14} />
            </Button>
          </Link>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <HeartPulse size={18} className="text-sky-600" />
            <h2 className="font-semibold text-slate-900">Data Health Center</h2>
          </div>
          <p className="mb-4 text-sm text-slate-500">
            Continuously scan for duplicates, orphans, numbering issues, and ZATCA consistency.
          </p>
          <Link href="/settings/production-readiness/data-health">
            <Button variant="secondary">
              Open Data Health <ArrowRight size={14} />
            </Button>
          </Link>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 font-semibold text-slate-900">Go-Live Checklist</h2>
        <ul className="space-y-2">
          {data.readiness.checklist.map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 px-3 py-2"
            >
              <div className="flex items-center gap-2 text-sm">
                {item.status === 'complete' ? (
                  <CheckCircle2 size={16} className="text-emerald-500" />
                ) : (
                  <AlertTriangle
                    size={16}
                    className={item.status === 'blocked' ? 'text-rose-500' : 'text-amber-500'}
                  />
                )}
                <span className="font-medium text-slate-800">{item.label}</span>
                {item.required && (
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase text-slate-500">
                    Required
                  </span>
                )}
              </div>
              {item.status !== 'complete' && item.fixHref && (
                <Link href={item.fixHref} className="text-xs font-medium text-indigo-600 hover:underline">
                  Fix Now
                </Link>
              )}
            </li>
          ))}
        </ul>
      </div>

      {data.readiness.blocked.length > 0 && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5">
          <h2 className="mb-3 font-semibold text-rose-900">Blocked — Required</h2>
          <ul className="space-y-2">
            {data.readiness.blocked.map((b) => (
              <li key={b.id} className="flex justify-between gap-3 text-sm text-rose-800">
                <span>
                  <strong>{b.label}:</strong> {b.message}
                </span>
                {b.fixHref && (
                  <Link href={b.fixHref} className="shrink-0 font-medium underline">
                    Fix Now
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Activity size={16} /> Readiness History
          </div>
          <ul className="space-y-1 text-sm text-slate-600">
            {data.readiness.history.length === 0 && <li>No scans yet.</li>}
            {data.readiness.history.slice(0, 8).map((h, i) => (
              <li key={i} className="flex justify-between">
                <span>{new Date(h.recorded_at).toLocaleString()}</span>
                <span className="font-medium">
                  {h.score}% · {h.verdict}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Activity size={16} /> Data Health History
          </div>
          <ul className="space-y-1 text-sm text-slate-600">
            {data.dataHealth.history.length === 0 && <li>No scans yet.</li>}
            {data.dataHealth.history.slice(0, 8).map((h, i) => (
              <li key={i} className="flex justify-between">
                <span>{new Date(h.recorded_at).toLocaleString()}</span>
                <span className="font-medium">{h.score}%</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
