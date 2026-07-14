'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { BarChart3, Download, Play, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import { readApiError } from '@/lib/api-client'

interface CatalogEntry {
  key: string
  title: string
  description: string
  category: string
  supportsExport: boolean
}

export default function EnterpriseReportsPage() {
  const [catalog, setCatalog] = useState<CatalogEntry[]>([])
  const [selected, setSelected] = useState('profit-loss')
  const [category, setCategory] = useState('')
  const [search, setSearch] = useState('')
  const [from, setFrom] = useState(`${new Date().getFullYear()}-01-01`)
  const [to, setTo] = useState(new Date().toISOString().substring(0, 10))
  const [result, setResult] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetch('/api/reporting/catalog')
      .then((r) => r.json())
      .then((d) => setCatalog(d.reports ?? []))
  }, [])

  const filtered = catalog.filter((r) => {
    if (category && r.category !== category) return false
    if (search && !r.title.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const runReport = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/reporting/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reportKey: selected,
        period: { from: new Date(from).toISOString(), to: new Date(to).toISOString(), preset: 'custom' },
        page: 1,
        pageSize: 100,
      }),
    })
    if (res.ok) setResult(await res.json())
    else alert(await readApiError(res))
    setLoading(false)
  }, [selected, from, to])

  async function exportReport(format: string) {
    const res = await fetch('/api/reporting/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reportKey: selected,
        format,
        period: { from: new Date(from).toISOString(), to: new Date(to).toISOString(), preset: 'custom' },
      }),
    })
    if (!res.ok) {
      alert(await readApiError(res))
      return
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${selected}.${format === 'xlsx' ? 'xlsx' : format === 'pdf' ? 'pdf' : 'csv'}`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="p-6 max-w-[1600px] mx-auto space-y-6">
      <PageHeader
        title="Enterprise Reports"
        subtitle="Unified reporting engine with filters, export, and drill-down — legacy report APIs remain unchanged"
        breadcrumb={[{ label: 'Reports' }, { label: 'Enterprise' }]}
        action={(
          <div className="flex gap-2">
            <Link href="/reports/analytics" className="inline-flex items-center h-9 px-4 text-sm rounded-lg border border-slate-200 bg-white hover:bg-slate-50">
              <BarChart3 className="w-4 h-4 mr-2" /> Analytics
            </Link>
            <Link href="/reports/builder" className="inline-flex items-center h-9 px-4 text-sm rounded-lg border border-slate-200 bg-white hover:bg-slate-50">
              Report Builder
            </Link>
          </div>
        )}
      />

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="space-y-3">
          <Input placeholder="Search reports…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select className="w-full border rounded-lg px-3 py-2 text-sm" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            <option value="financial">Financial</option>
            <option value="operational">Operational</option>
            <option value="analytics">Analytics</option>
          </select>
          <div className="rounded-xl border max-h-[500px] overflow-y-auto divide-y">
            {filtered.map((r) => (
              <button
                key={r.key}
                type="button"
                onClick={() => setSelected(r.key)}
                className={`w-full text-left p-3 text-sm hover:bg-slate-50 ${selected === r.key ? 'bg-indigo-50 border-l-2 border-indigo-500' : ''}`}
              >
                <div className="font-medium">{r.title}</div>
                <div className="text-xs text-muted-foreground">{r.category}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="lg:col-span-3 space-y-4">
          <div className="rounded-xl border bg-card p-4 flex flex-wrap items-end gap-3">
            <div>
              <label className="text-xs text-muted-foreground">From</label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">To</label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <Button onClick={runReport} disabled={loading}>
              <Play className="w-4 h-4 mr-2" /> Run
            </Button>
            <Button variant="outline" onClick={() => exportReport('csv')}>
              <Download className="w-4 h-4 mr-2" /> CSV
            </Button>
            <Button variant="outline" onClick={() => exportReport('xlsx')}>Excel</Button>
            <Button variant="outline" onClick={() => exportReport('pdf')}>PDF</Button>
          </div>

          {result ? (
            <div className="rounded-xl border bg-card p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">{String(result.title)}</h3>
                <span className="text-xs text-muted-foreground">{String(result.generatedAt ?? '').substring(0, 19)}</span>
              </div>
              <pre className="text-xs overflow-auto max-h-[500px] bg-slate-50 rounded-lg p-4">
                {JSON.stringify(result.data ?? result.rows ?? result, null, 2)}
              </pre>
            </div>
          ) : (
            <div className="rounded-xl border bg-card p-12 text-center text-muted-foreground">
              <Search className="w-8 h-8 mx-auto mb-3 opacity-40" />
              Select a report and click Run
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
