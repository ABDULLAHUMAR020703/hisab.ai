'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { ImportHistoryFilters } from '@/components/import-export/ImportHistoryFilters'
import { ImportHistoryTable } from '@/components/import-export/ImportHistoryTable'
import { ImportHistoryDetailModal } from '@/components/import-export/ImportHistoryDetail'
import type { ImportHistoryDetail, ImportHistoryRecord } from '@/lib/import-export/history/import-history.types'
import { readApiError } from '@/lib/api-client'

import { MODULE_CATALOG } from '@/lib/import-export/registry/module-catalog'

export default function ImportHistoryPage() {
  const searchParams = useSearchParams()
  const [items, setItems] = useState<ImportHistoryRecord[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [filters, setFilters] = useState({
    search: '',
    module: '',
    status: '',
    dateFrom: '',
    dateTo: '',
  })
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<ImportHistoryDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(filters.search), 300)
    return () => window.clearTimeout(timer)
  }, [filters.search])

  const query = useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      limit: '25',
      sortBy: 'created_at',
      sortDir: 'desc',
    })
    if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim())
    if (filters.module) params.set('module', filters.module)
    if (filters.status) params.set('status', filters.status)
    if (filters.dateFrom) params.set('dateFrom', filters.dateFrom)
    if (filters.dateTo) params.set('dateTo', filters.dateTo)
    if (filters.status === 'processing') params.set('includeActive', 'true')
    return params
  }, [page, debouncedSearch, filters])

  const load = useCallback(async () => {
    setLoading(true)
    const response = await fetch(`/api/import-export/history?${query}`)
    if (response.ok) {
      const payload = await response.json()
      setItems(payload.items ?? [])
      setTotal(payload.total ?? 0)
    }
    setLoading(false)
  }, [query])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const id = searchParams.get('id')
    if (id) {
      setSelectedId(id)
    }
  }, [searchParams])

  useEffect(() => {
    if (!selectedId) {
      setDetail(null)
      return
    }

    setDetailLoading(true)
    fetch(`/api/import-export/history/${selectedId}`)
      .then(async (response) => (response.ok ? response.json() : null))
      .then((data) => setDetail(data))
      .finally(() => setDetailLoading(false))
  }, [selectedId])

  async function handleDelete(record: ImportHistoryRecord | ImportHistoryDetail) {
    if (!confirm('Delete this import history record? Imported business data will not be affected.')) return
    const response = await fetch(`/api/import-export/history/${record.id}`, { method: 'DELETE' })
    if (!response.ok) {
      alert(await readApiError(response))
      return
    }
    setSelectedId(null)
    void load()
  }

  const totalPages = Math.max(1, Math.ceil(total / 25))

  return (
    <div className="p-6 max-w-[1600px] mx-auto space-y-4">
      <PageHeader
        title="Import History"
        subtitle={`${total} import record${total === 1 ? '' : 's'}`}
        breadcrumb={[{ label: 'Administration' }, { label: 'Import History' }]}
      />

      <ImportHistoryFilters
        search={filters.search}
        module={filters.module}
        status={filters.status}
        dateFrom={filters.dateFrom}
        dateTo={filters.dateTo}
        modules={[...MODULE_CATALOG]}
        onChange={(patch) => {
          setPage(1)
          setFilters((current) => ({ ...current, ...patch }))
        }}
      />

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden p-2">
        <ImportHistoryTable
          items={items}
          loading={loading}
          onView={(record) => setSelectedId(record.id)}
          onDelete={handleDelete}
        />
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">Page {page} of {totalPages}</p>
        <div className="flex gap-2">
          <Button variant="outline" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
            Previous
          </Button>
          <Button variant="outline" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>
            Next
          </Button>
        </div>
      </div>

      <ImportHistoryDetailModal
        open={Boolean(selectedId)}
        onClose={() => setSelectedId(null)}
        detail={detail}
        loading={detailLoading}
        onDelete={() => detail && void handleDelete(detail)}
      />
    </div>
  )
}
