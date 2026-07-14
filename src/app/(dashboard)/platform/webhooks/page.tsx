'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { PageHeader } from '@/components/ui/page-header'

interface WebhookEndpoint {
  id: string
  name: string
  url: string
  is_active: boolean
}

interface WebhookDelivery {
  id: string
  event_type: string
  status: string
  created_at: string
}

export default function PlatformWebhooksPage() {
  const [endpoints, setEndpoints] = useState<WebhookEndpoint[]>([])
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([])

  useEffect(() => {
    fetch('/api/platform/webhooks')
      .then((r) => r.json())
      .then((d) => {
        setEndpoints(d.endpoints ?? [])
        setDeliveries(d.deliveries ?? [])
      })
  }, [])

  return (
    <div className="p-6 max-w-[1100px] mx-auto space-y-6">
      <PageHeader
        title="Webhooks"
        subtitle="Outgoing webhooks with signing, retry, logs, and replay"
        breadcrumb={[{ label: 'Platform' }, { label: 'Webhooks' }]}
        action={<Link href="/platform" className="text-sm text-indigo-600 hover:underline">← Platform</Link>}
      />
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-700">Endpoints</h2>
        <div className="rounded-xl border divide-y">
          {endpoints.length === 0 ? (
            <div className="p-6 text-center text-muted-foreground">No webhook endpoints configured.</div>
          ) : endpoints.map((ep) => (
            <div key={ep.id} className="p-4">
              <div className="font-medium">{ep.name}</div>
              <div className="text-xs text-muted-foreground truncate">{ep.url}</div>
            </div>
          ))}
        </div>
      </section>
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-700">Recent deliveries</h2>
        <div className="rounded-xl border divide-y">
          {deliveries.length === 0 ? (
            <div className="p-6 text-center text-muted-foreground">No deliveries yet.</div>
          ) : deliveries.map((d) => (
            <div key={d.id} className="p-4 flex justify-between text-sm">
              <span>{d.event_type}</span>
              <span className="text-muted-foreground">{d.status} · {d.created_at?.slice(0, 16)}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
