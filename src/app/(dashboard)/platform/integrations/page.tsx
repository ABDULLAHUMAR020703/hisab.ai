'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { PageHeader } from '@/components/ui/page-header'

interface Connector {
  provider_key: string
  name: string
  connector_type: string
}

interface Connection {
  id: string
  name: string
  connector_key: string
  status: string
}

export default function PlatformIntegrationsPage() {
  const [connectors, setConnectors] = useState<Connector[]>([])
  const [connections, setConnections] = useState<Connection[]>([])

  useEffect(() => {
    fetch('/api/platform/integrations')
      .then((r) => r.json())
      .then((d) => {
        setConnectors(d.connectors ?? [])
        setConnections(d.connections ?? [])
      })
  }, [])

  return (
    <div className="p-6 max-w-[1100px] mx-auto space-y-6">
      <PageHeader
        title="Integrations"
        subtitle="Reusable connectors for QuickBooks, Stripe, Twilio, and more"
        breadcrumb={[{ label: 'Platform' }, { label: 'Integrations' }]}
        action={<Link href="/platform" className="text-sm text-indigo-600 hover:underline">← Platform</Link>}
      />
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-700">Available connectors</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {connectors.map((c) => (
            <div key={c.provider_key} className="rounded-xl border p-4">
              <div className="font-medium">{c.name}</div>
              <div className="text-xs text-muted-foreground">{c.connector_type} · {c.provider_key}</div>
            </div>
          ))}
        </div>
      </section>
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-700">Active connections</h2>
        <div className="rounded-xl border divide-y">
          {connections.length === 0 ? (
            <div className="p-6 text-center text-muted-foreground">No connections configured.</div>
          ) : connections.map((c) => (
            <div key={c.id} className="p-4 flex justify-between">
              <div>
                <div className="font-medium">{c.name}</div>
                <div className="text-xs text-muted-foreground">{c.connector_key}</div>
              </div>
              <span className="text-xs text-muted-foreground">{c.status}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
