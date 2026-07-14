'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Bell, CheckCheck, Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'

interface Notification {
  id: string
  title: string
  body?: string | null
  category: string
  channel: string
  read_at?: string | null
  created_at: string
}

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    const res = await fetch('/api/platform/notifications')
    if (res.ok) {
      const data = await res.json()
      setNotifications(data.notifications ?? [])
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function markRead(id: string) {
    await fetch('/api/platform/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notificationId: id }),
    })
    await load()
  }

  async function markAllRead() {
    await fetch('/api/platform/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markAllRead: true }),
    })
    await load()
  }

  const unread = notifications.filter((n) => !n.read_at).length

  return (
    <div className="p-6 max-w-[900px] mx-auto space-y-6">
      <PageHeader
        title="Notification Center"
        subtitle="In-app, email, SMS, and workflow notifications"
        breadcrumb={[{ label: 'Platform' }, { label: 'Notifications' }]}
        action={(
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={markAllRead} disabled={unread === 0}>
              <CheckCheck className="w-4 h-4 mr-1" /> Mark all read
            </Button>
            <Link href="/platform" className="inline-flex items-center h-8 px-3 text-sm rounded-lg border border-slate-200 bg-white hover:bg-slate-50">
              <Settings className="w-4 h-4 mr-1" /> Platform
            </Link>
          </div>
        )}
      />

      {loading ? (
        <div className="text-center text-muted-foreground py-12">Loading…</div>
      ) : notifications.length === 0 ? (
        <div className="rounded-xl border bg-card p-12 text-center text-muted-foreground">
          <Bell className="w-10 h-10 mx-auto mb-3 opacity-30" />
          You&apos;re all caught up
        </div>
      ) : (
        <div className="space-y-2">
          {notifications.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => !n.read_at && markRead(n.id)}
              className={`w-full text-left rounded-xl border p-4 transition-colors ${!n.read_at ? 'bg-indigo-50/50 border-indigo-200' : 'bg-card hover:bg-slate-50'}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-medium">{n.title}</div>
                  {n.body && <div className="text-sm text-muted-foreground mt-1">{n.body}</div>}
                  <div className="text-xs text-muted-foreground mt-2">
                    {n.category} · {n.channel} · {new Date(n.created_at).toLocaleString()}
                  </div>
                </div>
                {!n.read_at && <span className="w-2 h-2 rounded-full bg-indigo-500 shrink-0 mt-2" />}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
