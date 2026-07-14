'use client'

import { cn } from '@/lib/utils'
import { DataTable, TableAction, TableActions } from '@/components/ui/data-table'
import type { ImportHistoryRecord } from '@/lib/import-export/history/import-history.types'
import { formatDuration, formatImportDate } from './ImportHistoryFilters'

interface ImportHistoryTableProps {
  items: ImportHistoryRecord[]
  loading?: boolean
  onView: (record: ImportHistoryRecord) => void
  onDelete: (record: ImportHistoryRecord) => void
}

function statusBadge(status: string) {
  const styles: Record<string, string> = {
    completed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    failed: 'bg-red-50 text-red-700 border-red-200',
    cancelled: 'bg-slate-50 text-slate-600 border-slate-200',
    processing: 'bg-blue-50 text-blue-700 border-blue-200',
  }
  return (
    <span className={cn('badge capitalize', styles[status] ?? 'bg-slate-50 text-slate-600 border-slate-200')}>
      {status}
    </span>
  )
}

export function ImportHistoryTable({ items, loading, onView, onDelete }: ImportHistoryTableProps) {
  return (
    <DataTable
      loading={loading}
      data={items}
      emptyMessage="No import history found"
      rowKey={(row) => row.id}
      columns={[
        {
          key: 'date',
          label: 'Date & Time',
          render: (row) => formatImportDate(row.completedAt ?? row.createdAt),
        },
        { key: 'user', label: 'User', render: (row) => row.user.name ?? '—' },
        { key: 'module', label: 'Module', render: (row) => row.moduleDisplayName },
        { key: 'filename', label: 'File Name', render: (row) => row.filename },
        { key: 'fileFormat', label: 'Type', render: (row) => row.fileFormat.toUpperCase() },
        { key: 'totalRows', label: 'Total', align: 'right' },
        { key: 'importedCount', label: 'Imported', align: 'right' },
        { key: 'updatedCount', label: 'Updated', align: 'right' },
        { key: 'skippedCount', label: 'Skipped', align: 'right' },
        { key: 'failedCount', label: 'Failed', align: 'right' },
        {
          key: 'duration',
          label: 'Duration',
          align: 'right',
          render: (row) => formatDuration(row.durationMs),
        },
        {
          key: 'status',
          label: 'Status',
          align: 'center',
          render: (row) => statusBadge(row.status),
        },
        {
          key: 'actions',
          label: '',
          render: (row) => (
            <TableActions>
              <TableAction label="View" onClick={() => onView(row)} />
              {row.hasErrorReport && (
                <TableAction
                  label="Errors"
                  color="amber"
                  onClick={() => {
                    window.location.href = `/api/import-export/history/${row.id}/errors?format=csv`
                  }}
                />
              )}
              <TableAction label="Delete" color="red" onClick={() => onDelete(row)} />
            </TableActions>
          ),
        },
      ]}
    />
  )
}
