'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { PageHeader } from '@/components/ui/page-header'

interface NumberingSeries {
  id: string
  series_key: string
  prefix?: string
  suffix?: string
  padding?: number
  next_number: number
  is_active: boolean
}

export default function PlatformNumberingPage() {
  const [series, setSeries] = useState<NumberingSeries[]>([])

  useEffect(() => {
    fetch('/api/platform/numbering')
      .then((r) => r.json())
      .then((d) => setSeries(d.series ?? []))
  }, [])

  return (
    <div className="p-6 max-w-[1100px] mx-auto space-y-6">
      <PageHeader
        title="Numbering Engine"
        subtitle="Configurable document series — falls back to legacy getNextSequence()"
        breadcrumb={[{ label: 'Platform' }, { label: 'Numbering' }]}
        action={<Link href="/platform" className="text-sm text-indigo-600 hover:underline">← Platform</Link>}
      />
      <div className="rounded-xl border divide-y">
        {series.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">No numbering series configured. Legacy sequences still work.</div>
        ) : series.map((s) => (
          <div key={s.id} className="p-4 flex items-center justify-between hover:bg-slate-50">
            <div>
              <div className="font-medium">{s.series_key}</div>
              <div className="text-xs text-muted-foreground">
                {[s.prefix, `#${s.next_number}`, s.suffix].filter(Boolean).join('')} · Padding {s.padding ?? 0}
              </div>
            </div>
            <span className={`text-xs px-2 py-1 rounded-full ${s.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100'}`}>
              {s.is_active ? 'Active' : 'Inactive'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
