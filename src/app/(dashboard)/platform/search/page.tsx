'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'

interface SearchResult {
  entityType: string
  entityId: string
  title: string
  subtitle?: string
  url?: string
}

export default function GlobalSearchPage() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [recent, setRecent] = useState<Array<{ query: string; created_at: string }>>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetch('/api/platform/search?recent=true')
      .then((r) => r.json())
      .then((d) => setRecent(d.recent ?? []))
  }, [])

  async function search() {
    if (query.trim().length < 2) return
    setLoading(true)
    const res = await fetch(`/api/platform/search?q=${encodeURIComponent(query)}`)
    if (res.ok) {
      const data = await res.json()
      setResults(data.results ?? [])
    }
    setLoading(false)
  }

  return (
    <div className="p-6 max-w-[900px] mx-auto space-y-6">
      <PageHeader
        title="Global Search"
        subtitle="Search customers, vendors, invoices, bills, products, journals, documents, and more"
        breadcrumb={[{ label: 'Platform' }, { label: 'Search' }]}
        action={<Link href="/platform" className="text-sm text-indigo-600 hover:underline">← Platform</Link>}
      />

      <div className="flex gap-2">
        <Input
          placeholder="Search anything…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && search()}
        />
        <button type="button" onClick={search} className="inline-flex items-center h-9 px-4 rounded-lg bg-indigo-600 text-white text-sm">
          <Search className="w-4 h-4 mr-1" /> Search
        </button>
      </div>

      {recent.length > 0 && results.length === 0 && !loading && (
        <div className="text-sm text-muted-foreground">
          Recent: {recent.slice(0, 5).map((r) => r.query).join(', ')}
        </div>
      )}

      {loading ? (
        <div className="text-center text-muted-foreground py-8">Searching…</div>
      ) : results.length > 0 ? (
        <div className="rounded-xl border divide-y">
          {results.map((r) => (
            <div key={`${r.entityType}-${r.entityId}`} className="p-4 hover:bg-slate-50">
              <div className="text-xs uppercase text-muted-foreground">{r.entityType}</div>
              <div className="font-medium">{r.title}</div>
              {r.subtitle && <div className="text-sm text-muted-foreground">{r.subtitle}</div>}
              {r.url && <Link href={r.url} className="text-xs text-indigo-600 hover:underline mt-1 inline-block">Open →</Link>}
            </div>
          ))}
        </div>
      ) : query.length >= 2 && !loading ? (
        <div className="text-center text-muted-foreground py-8">No results found</div>
      ) : null}
    </div>
  )
}
