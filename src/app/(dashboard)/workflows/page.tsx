'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, Clock, History, Bell, XCircle, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { readApiError } from '@/lib/api-client'
import { cn } from '@/lib/utils'

type Tab = 'pending' | 'submissions' | 'history' | 'notifications'

interface WorkflowTask {
  id: string
  status: string
  comments?: string | null
  created_at: string
  instance?: {
    entity_type: string
    entity_label?: string | null
    entity_id: string
    status: string
    amount?: number | null
  }
  step?: { name?: string }
}

interface WorkflowInstance {
  id: string
  entity_type: string
  entity_label?: string | null
  entity_id: string
  status: string
  amount?: number | null
  submitted_at: string
}

interface HistoryRow {
  id: string
  action: string
  comments?: string | null
  created_at: string
  instance?: { entity_type?: string; entity_label?: string | null; entity_id?: string }
}

interface NotificationRow {
  id: string
  notification_type: string
  title: string
  body?: string | null
  is_read: boolean
  created_at: string
}

export default function WorkflowsPage() {
  const [tab, setTab] = useState<Tab>('pending')
  const [loading, setLoading] = useState(true)
  const [pendingTasks, setPendingTasks] = useState<WorkflowTask[]>([])
  const [mySubmissions, setMySubmissions] = useState<WorkflowInstance[]>([])
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [notifications, setNotifications] = useState<NotificationRow[]>([])
  const [pendingCount, setPendingCount] = useState(0)
  const [acting, setActing] = useState<string | null>(null)
  const [delegateUserId, setDelegateUserId] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const view = tab === 'notifications' ? 'notifications' : tab === 'history' ? 'history' : 'pending'
    const res = await fetch(`/api/workflows/dashboard?view=${view}`)
    if (!res.ok) {
      alert(await readApiError(res))
      setLoading(false)
      return
    }
    const data = await res.json()
    if (tab === 'history') setHistory(data.history ?? [])
    else if (tab === 'notifications') setNotifications(data.notifications ?? [])
    else {
      setPendingTasks(data.pendingTasks ?? [])
      setMySubmissions(data.mySubmissions ?? [])
      setPendingCount(data.pendingCount ?? 0)
    }
    setLoading(false)
  }, [tab])

  useEffect(() => { load() }, [load])

  async function actOnTask(taskId: string, action: 'approve' | 'reject' | 'delegate', comments?: string) {
    setActing(taskId)
    const body: Record<string, unknown> = { action, comments }
    if (action === 'delegate') {
      if (!delegateUserId.trim()) {
        alert('Enter delegate user ID')
        setActing(null)
        return
      }
      body.delegateUserId = delegateUserId.trim()
    }
    const res = await fetch(`/api/workflows/tasks/${taskId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) alert(await readApiError(res))
    else {
      setDelegateUserId('')
      await load()
    }
    setActing(null)
  }

  const tabs: { id: Tab; label: string; icon: typeof Clock; badge?: number }[] = [
    { id: 'pending', label: 'Pending approvals', icon: Clock, badge: pendingCount },
    { id: 'submissions', label: 'My submissions', icon: CheckCircle2 },
    { id: 'history', label: 'History', icon: History },
    { id: 'notifications', label: 'Notifications', icon: Bell },
  ]

  return (
    <div className="p-6 max-w-[1600px] mx-auto space-y-6">
      <PageHeader
        title="Approval Dashboard"
        subtitle="Review pending tasks, track submissions, and view approval history"
        breadcrumb={[{ label: 'Administration' }, { label: 'Workflows' }]}
        action={(
          <Link href="/workflows/designer" className="inline-flex items-center h-9 px-4 text-sm rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700">
            Workflow Designer
          </Link>
        )}
      />

      <div className="flex flex-wrap gap-2 border-b pb-2">
        {tabs.map((t) => {
          const Icon = t.icon
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                'inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                tab === t.id ? 'bg-primary text-primary-foreground' : 'hover:bg-muted',
              )}
            >
              <Icon className="w-4 h-4" />
              {t.label}
              {t.badge != null && t.badge > 0 && (
                <span className="ml-1 rounded-full bg-red-500 text-white text-xs px-2 py-0.5">{t.badge}</span>
              )}
            </button>
          )
        })}
      </div>

      {loading ? (
        <div className="text-muted-foreground py-12 text-center">Loading…</div>
      ) : tab === 'pending' ? (
        <div className="space-y-4">
          {pendingTasks.length === 0 ? (
            <div className="rounded-xl border bg-card p-8 text-center text-muted-foreground">
              No pending approval tasks.
            </div>
          ) : pendingTasks.map((task) => (
            <div key={task.id} className="rounded-xl border bg-card p-5 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-lg font-semibold">
                    {task.instance?.entity_label ?? task.instance?.entity_id}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {task.instance?.entity_type} · Step: {task.step?.name ?? '—'}
                    {task.instance?.amount != null && ` · Amount: ${task.instance.amount}`}
                  </div>
                </div>
                <span className="text-xs font-medium uppercase tracking-wide text-amber-600 bg-amber-50 px-2 py-1 rounded">
                  {task.status}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  disabled={acting === task.id}
                  onClick={() => actOnTask(task.id, 'approve')}
                >
                  <CheckCircle2 className="w-4 h-4 mr-1" /> Approve
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={acting === task.id}
                  onClick={() => actOnTask(task.id, 'reject', 'Rejected from dashboard')}
                >
                  <XCircle className="w-4 h-4 mr-1" /> Reject
                </Button>
                <div className="flex items-center gap-2">
                  <input
                    className="border rounded-md px-2 py-1 text-sm w-48"
                    placeholder="Delegate user ID"
                    value={delegateUserId}
                    onChange={(e) => setDelegateUserId(e.target.value)}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={acting === task.id}
                    onClick={() => actOnTask(task.id, 'delegate')}
                  >
                    <UserPlus className="w-4 h-4 mr-1" /> Delegate
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : tab === 'submissions' ? (
        <div className="rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left p-3">Document</th>
                <th className="text-left p-3">Type</th>
                <th className="text-left p-3">Amount</th>
                <th className="text-left p-3">Status</th>
                <th className="text-left p-3">Submitted</th>
              </tr>
            </thead>
            <tbody>
              {mySubmissions.length === 0 ? (
                <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">No active submissions</td></tr>
              ) : mySubmissions.map((s) => (
                <tr key={s.id} className="border-t">
                  <td className="p-3 font-medium">{s.entity_label ?? s.entity_id}</td>
                  <td className="p-3">{s.entity_type}</td>
                  <td className="p-3">{s.amount ?? '—'}</td>
                  <td className="p-3">{s.status}</td>
                  <td className="p-3">{new Date(s.submitted_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : tab === 'history' ? (
        <div className="rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left p-3">When</th>
                <th className="text-left p-3">Document</th>
                <th className="text-left p-3">Action</th>
                <th className="text-left p-3">Comments</th>
              </tr>
            </thead>
            <tbody>
              {history.length === 0 ? (
                <tr><td colSpan={4} className="p-6 text-center text-muted-foreground">No history yet</td></tr>
              ) : history.map((h) => (
                <tr key={h.id} className="border-t">
                  <td className="p-3">{new Date(h.created_at).toLocaleString()}</td>
                  <td className="p-3">
                    {h.instance?.entity_label ?? h.instance?.entity_id} ({h.instance?.entity_type})
                  </td>
                  <td className="p-3">{h.action}</td>
                  <td className="p-3 text-muted-foreground">{h.comments ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="space-y-3">
          {notifications.length === 0 ? (
            <div className="rounded-xl border bg-card p-8 text-center text-muted-foreground">
              No notifications.
            </div>
          ) : notifications.map((n) => (
            <div
              key={n.id}
              className={cn(
                'rounded-xl border bg-card p-4',
                !n.is_read && 'border-primary/40 bg-primary/5',
              )}
            >
              <div className="font-medium">{n.title}</div>
              {n.body && <div className="text-sm text-muted-foreground mt-1">{n.body}</div>}
              <div className="text-xs text-muted-foreground mt-2">
                {n.notification_type} · {new Date(n.created_at).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
