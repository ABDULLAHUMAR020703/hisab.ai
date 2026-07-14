'use client'

import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { DUPLICATE_STRATEGY_LABELS } from '@/lib/import-export/duplicate/strategies'
import type { ImportHistoryDetail } from '@/lib/import-export/history/import-history.types'
import { formatDuration, formatImportDate } from './ImportHistoryFilters'

interface ImportHistoryDetailModalProps {
  open: boolean
  onClose: () => void
  detail: ImportHistoryDetail | null
  loading?: boolean
  onDelete: () => void
}

export function ImportHistoryDetailModal({
  open,
  onClose,
  detail,
  loading,
  onDelete,
}: ImportHistoryDetailModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Import Details"
      size="lg"
      footer={
        detail && (
          <>
            {detail.hasErrorReport && (
              <a
                href={`/api/import-export/history/${detail.id}/errors?format=csv`}
                className="mr-auto text-sm text-indigo-600 hover:text-indigo-800 font-medium"
              >
                Download Error Report
              </a>
            )}
            <Button variant="danger" onClick={onDelete}>Delete History</Button>
            <Button onClick={onClose}>Close</Button>
          </>
        )
      }
    >
      {loading || !detail ? (
        <div className="py-8 text-center text-sm text-slate-400">Loading details…</div>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div><span className="text-slate-400">Module:</span> <span className="font-medium">{detail.moduleDisplayName}</span></div>
            <div><span className="text-slate-400">Status:</span> <span className="font-medium capitalize">{detail.status}</span></div>
            <div><span className="text-slate-400">File:</span> <span className="font-medium">{detail.filename}</span></div>
            <div><span className="text-slate-400">Type:</span> <span className="font-medium">{detail.fileFormat.toUpperCase()}</span></div>
            <div><span className="text-slate-400">User:</span> <span className="font-medium">{detail.user.name ?? '—'}</span></div>
            <div><span className="text-slate-400">Date:</span> <span className="font-medium">{formatImportDate(detail.completedAt ?? detail.createdAt)}</span></div>
            <div><span className="text-slate-400">Duration:</span> <span className="font-medium">{formatDuration(detail.durationMs)}</span></div>
            <div>
              <span className="text-slate-400">Duplicate Strategy:</span>{' '}
              <span className="font-medium">
                {detail.duplicateStrategy ? DUPLICATE_STRATEGY_LABELS[detail.duplicateStrategy] : '—'}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-3">
            {[
              ['Imported', detail.importedCount],
              ['Updated', detail.updatedCount],
              ['Skipped', detail.skippedCount],
              ['Failed', detail.failedCount],
            ].map(([label, value]) => (
              <div key={label as string} className="rounded-xl border border-slate-200 p-3 text-center">
                <p className="text-xs text-slate-400">{label as string}</p>
                <p className="text-xl font-bold text-slate-800">{value as number}</p>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-slate-200 p-4 text-sm">
            <p className="font-semibold text-slate-700 mb-2">Validation Summary</p>
            <div className="grid grid-cols-3 gap-3">
              <div>Valid rows: <strong>{detail.validRows ?? '—'}</strong></div>
              <div>Invalid rows: <strong>{detail.invalidRows ?? '—'}</strong></div>
              <div>Warnings: <strong>{detail.warningCount ?? '—'}</strong></div>
            </div>
            {detail.validationSummary && (
              <div className="mt-3 space-y-1 text-xs text-slate-500">
                {Object.entries(detail.validationSummary).map(([code, count]) => (
                  <div key={code}>{code}: {count}</div>
                ))}
              </div>
            )}
          </div>

          {detail.mappingSnapshot && (
            <div className="rounded-xl border border-slate-200 p-4 text-sm">
              <p className="font-semibold text-slate-700 mb-2">Column Mapping</p>
              <div className="space-y-1">
                {Object.entries(detail.mappingSnapshot).map(([field, source]) => (
                  <div key={field} className="flex justify-between gap-4">
                    <span className="text-slate-500">{field}</span>
                    <span className="font-medium text-slate-700">{source}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
