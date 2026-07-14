'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'

export default function PlatformJobsPage() {
  const [stats, setStats] = useState<Record<string, number>>({})

  useEffect(() => {
    fetch('/api/platform/jobs').then((r) => r.json()).then((d) => setStats(d.stats ?? {}))
  }, [])

  async function processJobs() {
    await fetch('/api/platform/jobs', { method: 'POST' })
    const res = await fetch('/api/platform/jobs')
    const d = await res.json()
    setStats(d.stats ?? {})
  }

  return (
    <div className="p-6 max-w-[900px] mx-auto space-y-6">
      <PageHeader title="Job Queue" subtitle="Background jobs with retry and dead-letter support" breadcrumb={[{ label: 'Platform' }, { label: 'Jobs' }]} action={<Link href="/platform" className="text-sm text-indigo-600">← Back</Link>} />
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {Object.entries(stats).map(([k, v]) => (
          <div key={k} className="rounded-xl border p-4 text-center">
            <div className="text-xs text-muted-foreground">{k}</div>
            <div className="text-2xl font-semibold">{v}</div>
          </div>
        ))}
      </div>
      <Button onClick={processJobs}>Process pending jobs</Button>
    </div>
  )
}
