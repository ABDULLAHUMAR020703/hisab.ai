'use client'

import { useCallback, useEffect, useState } from 'react'
import { Shield, RefreshCw, CheckCircle2, XCircle, Play } from 'lucide-react'
import { formatDate, cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { readApiError } from '@/lib/api-client'

interface DashboardData {
  stats: {
    submitted: number
    cleared: number
    reported: number
    failed: number
    pending: number
  }
  activity: Array<{
    id: string
    invoiceNo: string
    invoiceType: string
    zatcaStatus: string
    requestId: string | null
    submittedAt: string | null
    responseMessage: string | null
  }>
  auditLogs: Array<{
    id: string
    action: string
    result: string
    message: string | null
    userName: string | null
    createdAt: string
  }>
  sandboxTests: Array<{
    id: string
    scenario: string
    passed: boolean
    error: string | null
    durationMs: number | null
    createdAt: string
  }>
}

export default function ZatcaDashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [runningTests, setRunningTests] = useState(false)
  const [testMsg, setTestMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/zatca/dashboard')
    if (res.ok) setData(await res.json())
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function runSandboxTests() {
    setRunningTests(true)
    setTestMsg(null)
    const res = await fetch('/api/zatca/sandbox/run', { method: 'POST' })
    if (!res.ok) {
      setTestMsg(await readApiError(res))
      setRunningTests(false)
      return
    }
    const result = await res.json()
    if (res.ok) {
      setTestMsg(`Sandbox tests: ${result.summary.passed}/${result.summary.total} passed`)
      load()
    } else {
      setTestMsg(result.error || 'Test run failed')
    }
    setRunningTests(false)
  }

  const stats = data?.stats

  return (
    <div className="p-6 max-w-[1600px] mx-auto space-y-6">
      <PageHeader
        title="ZATCA Monitoring"
        subtitle="E-invoicing submission status, audit trail, and sandbox tests"
        breadcrumb={[{ label: 'Reports & Tax' }, { label: 'ZATCA' }]}
        action={
          <div className="flex gap-2">
            <Button variant="outline" onClick={load} disabled={loading}>
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Refresh
            </Button>
            <Button onClick={runSandboxTests} loading={runningTests}>
              <Play size={15} /> Run Sandbox Tests
            </Button>
          </div>
        }
      />

      {testMsg && (
        <div className="text-sm font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-2">
          {testMsg}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: 'Submitted', value: stats?.submitted ?? 0, color: 'text-indigo-600', bg: 'bg-indigo-50' },
          { label: 'Cleared', value: stats?.cleared ?? 0, color: 'text-emerald-600', bg: 'bg-emerald-50' },
          { label: 'Reported', value: stats?.reported ?? 0, color: 'text-blue-600', bg: 'bg-blue-50' },
          { label: 'Failed', value: stats?.failed ?? 0, color: 'text-red-600', bg: 'bg-red-50' },
          { label: 'Pending', value: stats?.pending ?? 0, color: 'text-amber-600', bg: 'bg-amber-50' },
        ].map((s) => (
          <div key={s.label} className={cn('rounded-xl border border-slate-200 px-4 py-4', s.bg)}>
            <p className="text-xs text-slate-500 font-medium">{s.label}</p>
            <p className={cn('text-2xl font-bold mt-1', s.color)}>{s.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
            <Shield size={16} className="text-indigo-600" />
            <h2 className="font-semibold text-slate-900">Recent Submissions</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-[11px] uppercase text-slate-400">
                  <th className="px-4 py-2">Invoice</th>
                  <th className="px-4 py-2">Type</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Request ID</th>
                  <th className="px-4 py-2">Submitted</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {loading ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">Loading...</td></tr>
                ) : !data?.activity.length ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">No submissions yet</td></tr>
                ) : data.activity.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-2 font-mono text-xs text-indigo-600">{row.invoiceNo}</td>
                    <td className="px-4 py-2 text-xs">{row.invoiceType}</td>
                    <td className="px-4 py-2">
                      <span className={cn(
                        'text-xs font-semibold px-2 py-0.5 rounded-full',
                        row.zatcaStatus === 'CLEARED' && 'bg-emerald-100 text-emerald-700',
                        row.zatcaStatus === 'REPORTED' && 'bg-blue-100 text-blue-700',
                        row.zatcaStatus === 'FAILED' && 'bg-red-100 text-red-700',
                        row.zatcaStatus === 'PENDING' && 'bg-amber-100 text-amber-700',
                        !['CLEARED', 'REPORTED', 'FAILED', 'PENDING'].includes(row.zatcaStatus) && 'bg-slate-100 text-slate-600',
                      )}>
                        {row.zatcaStatus}
                      </span>
                    </td>
                    <td className="px-4 py-2 font-mono text-[10px] text-slate-500 max-w-[120px] truncate">
                      {row.requestId ?? '—'}
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-500">
                      {row.submittedAt ? formatDate(row.submittedAt) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100">
              <h2 className="font-semibold text-slate-900">Audit Log</h2>
            </div>
            <div className="max-h-64 overflow-y-auto divide-y divide-slate-50">
              {data?.auditLogs.map((log) => (
                <div key={log.id} className="px-4 py-3 flex items-start gap-2 text-sm">
                  {log.result === 'SUCCESS'
                    ? <CheckCircle2 size={14} className="text-emerald-500 mt-0.5 shrink-0" />
                    : <XCircle size={14} className="text-red-500 mt-0.5 shrink-0" />}
                  <div className="min-w-0">
                    <p className="font-medium text-slate-700">{log.action.replace(/_/g, ' ')}</p>
                    <p className="text-xs text-slate-400 truncate">{log.message ?? log.userName ?? '—'}</p>
                    <p className="text-[10px] text-slate-300">{formatDate(log.createdAt)}</p>
                  </div>
                </div>
              )) ?? <p className="px-4 py-8 text-center text-slate-400 text-sm">No audit entries</p>}
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100">
              <h2 className="font-semibold text-slate-900">Sandbox Test Results</h2>
            </div>
            <div className="divide-y divide-slate-50">
              {data?.sandboxTests.map((test) => (
                <div key={test.id} className="px-4 py-3 flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    {test.passed
                      ? <CheckCircle2 size={14} className="text-emerald-500" />
                      : <XCircle size={14} className="text-red-500" />}
                    <span className="font-medium">{test.scenario}</span>
                  </div>
                  <span className="text-xs text-slate-400">
                    {test.durationMs ? `${test.durationMs}ms` : ''} · {formatDate(test.createdAt)}
                  </span>
                </div>
              )) ?? <p className="px-4 py-8 text-center text-slate-400 text-sm">No test runs yet</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
