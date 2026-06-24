'use client'

import { useCallback, useEffect, useState } from 'react'
import { Shield, RefreshCw, CheckCircle2, XCircle, Play, Activity } from 'lucide-react'
import { formatDate, cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { ZatcaBadge } from '@/components/ui/badge'
import { readApiError } from '@/lib/api-client'

interface DashboardData {
  stats: {
    submitted: number; cleared: number; reported: number; failed: number; pending: number
    successRate: number; lastSubmissionAt: string | null; lastSuccessAt: string | null
  }
  operations: {
    environment: string; connected: boolean; compliancePassed: boolean; productionCsidIssued: boolean
    certificateStatus: { hasCertificate: boolean; label?: string }
  }
  activity: Array<{
    id: string; invoiceNo: string; invoiceType: string; zatcaStatus: string
    requestId: string | null; globalTransactionId: string | null; submissionRoute: string | null
    submittedAt: string | null; responseMessage: string | null
  }>
  auditLogs: Array<{
    id: string; action: string; result: string; message: string | null
    userName: string | null; createdAt: string
  }>
  sandboxTests: Array<{
    id: string; scenario: string; passed: boolean; error: string | null
    durationMs: number | null; createdAt: string
  }>
}

interface ApiLog {
  id: string; endpoint: string; httpCode: string; success: boolean
  durationMs: number | null; correlationId: string | null
  globalTransactionId: string | null; timestamp: string
}

export default function ZatcaDashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [apiLogs, setApiLogs] = useState<ApiLog[]>([])
  const [loading, setLoading] = useState(true)
  const [runningTests, setRunningTests] = useState(false)
  const [testMsg, setTestMsg] = useState<string | null>(null)
  const [showDevTools, setShowDevTools] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [dashRes, logsRes] = await Promise.all([
      fetch('/api/zatca/dashboard'),
      fetch('/api/zatca/api-logs'),
    ])
    if (dashRes.ok) setData(await dashRes.json())
    if (logsRes.ok) setApiLogs(await logsRes.json())
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
    setTestMsg(`Sandbox tests: ${result.summary.passed}/${result.summary.total} passed`)
    load()
    setRunningTests(false)
  }

  const stats = data?.stats
  const ops = data?.operations

  return (
    <div className="p-6 max-w-[1600px] mx-auto space-y-6">
      <PageHeader
        title="ZATCA Monitoring"
        subtitle="Production e-invoicing health, submissions, and audit trail"
        breadcrumb={[{ label: 'Reports & Tax' }, { label: 'ZATCA Monitor' }]}
        action={
          <Button variant="outline" onClick={load} disabled={loading}>
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Refresh
          </Button>
        }
      />

      {testMsg && (
        <div className="text-sm font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-2">{testMsg}</div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        {[
          { label: 'Connection', value: ops?.connected ? 'Connected' : 'Offline', ok: ops?.connected },
          { label: 'Environment', value: ops?.environment ?? '—' },
          { label: 'Compliance', value: ops?.compliancePassed ? 'Passed' : 'Pending', ok: ops?.compliancePassed },
          { label: 'Production CSID', value: ops?.productionCsidIssued ? 'Issued' : '—', ok: ops?.productionCsidIssued },
          { label: 'Submitted', value: stats?.submitted ?? 0 },
          { label: 'Failed', value: stats?.failed ?? 0, bad: (stats?.failed ?? 0) > 0 },
          { label: 'Success Rate', value: `${stats?.successRate ?? 0}%`, ok: (stats?.successRate ?? 0) >= 90 },
          { label: 'Last Success', value: stats?.lastSuccessAt ? formatDate(stats.lastSuccessAt) : '—' },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-slate-200 bg-white px-3 py-3 shadow-sm">
            <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide">{s.label}</p>
            <p className={cn('text-sm font-bold mt-1 truncate',
              s.ok === true && 'text-emerald-600',
              s.bad && 'text-red-600',
              s.ok === false && 'text-amber-600',
            )}>{s.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: 'Cleared', value: stats?.cleared ?? 0, color: 'text-emerald-600', bg: 'bg-emerald-50' },
          { label: 'Reported', value: stats?.reported ?? 0, color: 'text-blue-600', bg: 'bg-blue-50' },
          { label: 'Pending', value: stats?.pending ?? 0, color: 'text-amber-600', bg: 'bg-amber-50' },
          { label: 'Failed', value: stats?.failed ?? 0, color: 'text-red-600', bg: 'bg-red-50' },
          { label: 'Last Submission', value: stats?.lastSubmissionAt ? formatDate(stats.lastSubmissionAt) : '—', color: 'text-slate-700', bg: 'bg-slate-50' },
        ].map((s) => (
          <div key={s.label} className={cn('rounded-xl border border-slate-200 px-4 py-4', s.bg)}>
            <p className="text-xs text-slate-500 font-medium">{s.label}</p>
            <p className={cn('text-lg font-bold mt-1 truncate', s.color)}>{s.value}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
          <Activity size={16} className="text-indigo-600" />
          <h2 className="font-semibold text-slate-900">Recent Submissions</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-[11px] uppercase text-slate-400">
                <th className="px-4 py-2">Invoice</th>
                <th className="px-4 py-2">Type</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Route</th>
                <th className="px-4 py-2">Request ID</th>
                <th className="px-4 py-2">Global Txn ID</th>
                <th className="px-4 py-2">Submitted</th>
                <th className="px-4 py-2">Response</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {loading ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400">Loading...</td></tr>
              ) : !data?.activity.length ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400">No submissions yet</td></tr>
              ) : data.activity.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50/60">
                  <td className="px-4 py-2 font-mono text-xs text-indigo-600">{row.invoiceNo}</td>
                  <td className="px-4 py-2 text-xs">{row.invoiceType.replaceAll('_', ' ')}</td>
                  <td className="px-4 py-2"><ZatcaBadge status={row.zatcaStatus} /></td>
                  <td className="px-4 py-2 text-xs capitalize">{row.submissionRoute ?? '—'}</td>
                  <td className="px-4 py-2 font-mono text-[10px] text-slate-500 max-w-[100px] truncate">{row.requestId ?? '—'}</td>
                  <td className="px-4 py-2 font-mono text-[10px] text-slate-500 max-w-[100px] truncate">{row.globalTransactionId ?? '—'}</td>
                  <td className="px-4 py-2 text-xs text-slate-500">{row.submittedAt ? formatDate(row.submittedAt) : '—'}</td>
                  <td className="px-4 py-2 text-xs text-slate-500 max-w-[140px] truncate">{row.responseMessage ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
            <Shield size={16} className="text-indigo-600" />
            <h2 className="font-semibold text-slate-900">Audit Log</h2>
          </div>
          <div className="max-h-80 overflow-y-auto divide-y divide-slate-50">
            {data?.auditLogs.length ? data.auditLogs.map((log) => (
              <div key={log.id} className="px-4 py-3 flex items-start gap-2 text-sm">
                {log.result === 'SUCCESS'
                  ? <CheckCircle2 size={14} className="text-emerald-500 mt-0.5 shrink-0" />
                  : <XCircle size={14} className="text-red-500 mt-0.5 shrink-0" />}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium text-slate-700">{log.action.replace(/_/g, ' ')}</p>
                    <span className="text-[10px] text-slate-400">{formatDate(log.createdAt)}</span>
                  </div>
                  <p className="text-xs text-slate-500 truncate">{log.message ?? log.userName ?? '—'}</p>
                </div>
              </div>
            )) : <p className="px-4 py-8 text-center text-slate-400 text-sm">No audit entries</p>}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="font-semibold text-slate-900">API Log</h2>
            <p className="text-xs text-slate-400 mt-0.5">Recent ZATCA HTTP calls</p>
          </div>
          <div className="overflow-x-auto max-h-80 overflow-y-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-[10px] uppercase text-slate-400">
                  <th className="px-3 py-2">Endpoint</th>
                  <th className="px-3 py-2">Code</th>
                  <th className="px-3 py-2">Duration</th>
                  <th className="px-3 py-2">Global Txn</th>
                  <th className="px-3 py-2">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {apiLogs.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400 text-sm">No API calls logged yet</td></tr>
                ) : apiLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/60">
                    <td className="px-3 py-2 text-xs font-mono truncate max-w-[120px]">{log.endpoint}</td>
                    <td className="px-3 py-2">
                      <span className={cn('text-xs font-semibold', log.success ? 'text-emerald-600' : 'text-red-600')}>{log.httpCode}</span>
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500">{log.durationMs != null ? `${log.durationMs}ms` : '—'}</td>
                    <td className="px-3 py-2 font-mono text-[10px] text-slate-500 truncate max-w-[90px]">{log.globalTransactionId ?? log.correlationId ?? '—'}</td>
                    <td className="px-3 py-2 text-[10px] text-slate-400">{formatDate(log.timestamp)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/50 overflow-hidden">
        <button
          type="button"
          onClick={() => setShowDevTools(v => !v)}
          className="w-full px-5 py-3 flex items-center justify-between text-left hover:bg-slate-100/50 transition-colors"
        >
          <div>
            <h2 className="font-semibold text-slate-800 text-sm">Developer Tools</h2>
            <p className="text-xs text-slate-500">Sandbox compliance test runner (simulation only)</p>
          </div>
          <span className="text-xs text-slate-400">{showDevTools ? 'Hide' : 'Show'}</span>
        </button>
        {showDevTools && (
          <div className="border-t border-slate-200 p-5 space-y-4">
            <div className="flex gap-2">
              <Button onClick={runSandboxTests} loading={runningTests} size="sm">
                <Play size={14} /> Run Sandbox Tests
              </Button>
            </div>
            <div className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
              {data?.sandboxTests.length ? data.sandboxTests.map((test) => (
                <div key={test.id} className="px-4 py-3 text-sm flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    {test.passed ? <CheckCircle2 size={14} className="text-emerald-500" /> : <XCircle size={14} className="text-red-500" />}
                    <span className="font-medium">{test.scenario}</span>
                  </div>
                  <span className="text-xs text-slate-400">{test.durationMs ? `${test.durationMs}ms` : ''} · {formatDate(test.createdAt)}</span>
                </div>
              )) : <p className="px-4 py-6 text-center text-slate-400 text-sm">No sandbox test runs yet</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
