'use client'

import { SearchBar, FilterBar } from '@/components/ui/page-header'
import { Input } from '@/components/ui/input'

interface ImportHistoryFiltersProps {
  search: string
  module: string
  status: string
  dateFrom: string
  dateTo: string
  modules: Array<{ key: string; displayName: string }>
  onChange: (patch: Partial<{
    search: string
    module: string
    status: string
    dateFrom: string
    dateTo: string
  }>) => void
}

export function ImportHistoryFilters({
  search,
  module,
  status,
  dateFrom,
  dateTo,
  modules,
  onChange,
}: ImportHistoryFiltersProps) {
  return (
    <FilterBar>
      <SearchBar
        value={search}
        onChange={(value) => onChange({ search: value })}
        placeholder="Search by filename..."
        className="flex-1 max-w-sm"
      />
      <select
        className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
        value={module}
        onChange={(event) => onChange({ module: event.target.value })}
      >
        <option value="">All modules</option>
        {modules.map((item) => (
          <option key={item.key} value={item.key}>{item.displayName}</option>
        ))}
      </select>
      <select
        className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
        value={status}
        onChange={(event) => onChange({ status: event.target.value })}
      >
        <option value="">All statuses</option>
        <option value="completed">Completed</option>
        <option value="failed">Failed</option>
        <option value="cancelled">Cancelled</option>
        <option value="processing">Processing</option>
      </select>
      <Input
        type="date"
        value={dateFrom}
        onChange={(event) => onChange({ dateFrom: event.target.value })}
        className="w-40"
      />
      <Input
        type="date"
        value={dateTo}
        onChange={(event) => onChange({ dateTo: event.target.value })}
        className="w-40"
      />
    </FilterBar>
  )
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '—'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export function formatImportDate(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleString()
}

export { formatDuration }
