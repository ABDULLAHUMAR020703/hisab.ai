'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { PageHeader } from '@/components/ui/page-header'

interface ApiKeyRow {
  id: string
  name: string
  key_prefix: string
  scopes: string[]
  rate_limit_per_minute: number
  is_active: boolean
  last_used_at?: string
}

export default function PlatformApiKeysPage() {
  const [keys, setKeys] = useState<ApiKeyRow[]>([])

  useEffect(() => {
    fetch('/api/platform/api-keys')
      .then((r) => r.json())
      .then((d) => setKeys(d.keys ?? []))
  }, [])

  return (
    <div className="p-6 max-w-[1100px] mx-auto space-y-6">
      <PageHeader
        title="API Keys"
        subtitle="Scopes, rate limits, and usage logging"
        breadcrumb={[{ label: 'Platform' }, { label: 'API Keys' }]}
        action={<Link href="/platform" className="text-sm text-indigo-600 hover:underline">← Platform</Link>}
      />
      <div className="rounded-xl border divide-y">
        {keys.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">No API keys yet. Create keys via POST /api/platform/api-keys.</div>
        ) : keys.map((key) => (
          <div key={key.id} className="p-4 flex items-center justify-between hover:bg-slate-50">
            <div>
              <div className="font-medium">{key.name}</div>
              <div className="text-xs text-muted-foreground">
                {key.key_prefix}… · {key.scopes?.join(', ')} · {key.rate_limit_per_minute}/min
              </div>
            </div>
            <span className={`text-xs px-2 py-1 rounded-full ${key.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100'}`}>
              {key.is_active ? 'Active' : 'Inactive'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
