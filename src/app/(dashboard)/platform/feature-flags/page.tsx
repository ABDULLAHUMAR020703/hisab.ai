'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { PageHeader } from '@/components/ui/page-header'

interface FeatureFlag {
  flag_key: string
  name: string
  description?: string
  default_enabled: boolean
}

export default function PlatformFeatureFlagsPage() {
  const [flags, setFlags] = useState<FeatureFlag[]>([])

  useEffect(() => {
    fetch('/api/platform/feature-flags')
      .then((r) => r.json())
      .then((d) => setFlags(d.flags ?? []))
  }, [])

  return (
    <div className="p-6 max-w-[1100px] mx-auto space-y-6">
      <PageHeader
        title="Feature Flags"
        subtitle="Company, branch, and user-level gradual rollout"
        breadcrumb={[{ label: 'Platform' }, { label: 'Feature Flags' }]}
        action={<Link href="/platform" className="text-sm text-indigo-600 hover:underline">← Platform</Link>}
      />
      <div className="rounded-xl border divide-y">
        {flags.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">No feature flags defined.</div>
        ) : flags.map((flag) => (
          <div key={flag.flag_key} className="p-4 flex items-center justify-between hover:bg-slate-50">
            <div>
              <div className="font-medium">{flag.name}</div>
              <div className="text-xs text-muted-foreground">{flag.flag_key}{flag.description ? ` · ${flag.description}` : ''}</div>
            </div>
            <span className={`text-xs px-2 py-1 rounded-full ${flag.default_enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100'}`}>
              Default: {flag.default_enabled ? 'On' : 'Off'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
