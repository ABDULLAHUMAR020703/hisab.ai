'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useMigrationHistory } from '@/components/import-export/MigrationSessionProvider'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import {
  formatMigrationDuration,
  migrationCenterPath,
} from '@/lib/import-export/wizard/migration-center-view'
import type { MigrationHistorySummary, MigrationSessionState } from '@/lib/import-export/wizard/migration-session'

const STATUS_TONE: Record<MigrationSessionState, string> = {
  running: 'bg-indigo-50 text-indigo-700',
  completed: 'bg-emerald-50 text-emerald-700',
  failed: 'bg-red-50 text-red-700',
  cancelled: 'bg-slate-100 text-slate-600',
}

const STATUS_LABEL: Record<MigrationSessionState, string> = {
  running: 'In Progress',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
}

export default function MigrationHistoryPage() {
  const { history, loadHistory } = useMigrationHistory()
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState<MigrationSessionState | ''>('')
  const limit = 25

  useEffect(() => {
    void loadHistory({ page, limit, status })
  }, [loadHistory, page, status])

  const totalPages = Math.max(1, Math.ceil(history.total / limit))

  return (
    <div className="mx-auto max-w-[1600px] space-y-4 p-6" data-migration-history>
      <PageHeader
        title="Migration History"
        subtitle={`${history.total} migration${history.total === 1 ? '' : 's'}`}
        breadcrumb={[{ label: 'Administration' }, { label: 'Migration History' }]}
        action={(
          <Link
            href="/migration-wizard"
            className="inline-flex h-9 items-center rounded-lg bg-indigo-600 px-4 text-sm font-medium text-white shadow-sm shadow-indigo-200 hover:bg-indigo-700"
          >
            New Migration
          </Link>
        )}
      />

      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm text-slate-600">
          Status
          <select
            className="ml-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm"
            value={status}
            onChange={(event) => {
              setPage(1)
              setStatus(event.target.value as MigrationSessionState | '')
            }}
          >
            <option value="">All</option>
            <option value="running">Running</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </label>
      </div>

      {history.error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{history.error}</p>}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Started</th>
              <th className="px-4 py-3">Completed</th>
              <th className="px-4 py-3">Duration</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Provider</th>
              <th className="px-4 py-3">Modules</th>
              <th className="px-4 py-3">Imported</th>
              <th className="px-4 py-3">Updated</th>
              <th className="px-4 py-3">Skipped</th>
              <th className="px-4 py-3">Failed</th>
              <th className="px-4 py-3">Warnings</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {history.loading && (
              <tr>
                <td colSpan={12} className="px-4 py-10 text-center text-slate-500">Loading migration history…</td>
              </tr>
            )}
            {!history.loading && history.items.length === 0 && (
              <tr>
                <td colSpan={12} className="px-4 py-10 text-center text-slate-500">No migrations yet.</td>
              </tr>
            )}
            {!history.loading && history.items.map((item: MigrationHistorySummary) => (
              <tr key={item.id} data-migration-id={item.id} className="border-t border-slate-100">
                <td className="px-4 py-3 whitespace-nowrap text-slate-700">{new Date(item.startedAt).toLocaleString()}</td>
                <td className="px-4 py-3 whitespace-nowrap text-slate-700">
                  {item.completedAt ? new Date(item.completedAt).toLocaleString() : '—'}
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-slate-700">{formatMigrationDuration(item.durationMs)}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_TONE[item.status]}`}>
                    {STATUS_LABEL[item.status]}
                  </span>
                </td>
                <td className="px-4 py-3 capitalize text-slate-700">{item.provider}</td>
                <td className="px-4 py-3 text-slate-700" title={item.modules.map((module) => module.label).join(', ')}>
                  {item.moduleCount}
                </td>
                <td className="px-4 py-3 text-slate-700">{item.importedCount.toLocaleString()}</td>
                <td className="px-4 py-3 text-slate-700">{item.updatedCount.toLocaleString()}</td>
                <td className="px-4 py-3 text-slate-700">{item.skippedCount.toLocaleString()}</td>
                <td className="px-4 py-3 text-slate-700">{item.failedCount.toLocaleString()}</td>
                <td className="px-4 py-3 text-slate-700">{item.warningCount.toLocaleString()}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    <Link
                      href={`${migrationCenterPath(item.id)}#final-report`}
                      className="inline-flex h-7 items-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      View Report
                    </Link>
                    <Link
                      href={`${migrationCenterPath(item.id)}#logs`}
                      className="inline-flex h-7 items-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      View Logs
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">Page {page} of {totalPages}</p>
        <div className="flex gap-2">
          <Button variant="outline" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</Button>
          <Button variant="outline" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>Next</Button>
        </div>
      </div>
    </div>
  )
}
