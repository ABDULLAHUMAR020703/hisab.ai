'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { RefreshCw } from 'lucide-react'
import { MigrationCenter } from '@/components/import-export/MigrationCenter'
import { useMigrationSession } from '@/components/import-export/MigrationSessionProvider'
import { readApiError } from '@/lib/api-client'
import type { HydratedMigrationSession } from '@/lib/import-export/wizard/migration-session'

const POLL_MS = 1_500

/**
 * Persistent Migration Center page.
 * Restores entirely from GET /api/import-export/migration-sessions/:id (session + jobs).
 * Layout provider continues coordinating workers; this page never invents progress.
 */
export default function MigrationCenterPage() {
  const params = useParams<{ sessionId: string }>()
  const sessionId = params.sessionId
  const router = useRouter()
  const { refresh: refreshProvider } = useMigrationSession()
  const [session, setSession] = useState<HydratedMigrationSession | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const response = await fetch(`/api/import-export/migration-sessions/${sessionId}`, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
    })
    if (response.status === 404) {
      setError('Migration session not found')
      setSession(null)
      return
    }
    if (!response.ok) throw new Error(await readApiError(response))
    const payload = await response.json() as { session: HydratedMigrationSession }
    setSession(payload.session)
    setError(null)
  }, [sessionId])

  useEffect(() => {
    let active = true
    setLoading(true)
    void load()
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Unable to load migration center.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    const timer = window.setInterval(() => {
      void load().catch(() => undefined)
    }, POLL_MS)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [load])

  async function handleRetry() {
    if (!session) return
    setBusy(true)
    setActionError(null)
    try {
      const response = await fetch(`/api/import-export/migration-sessions/${session.id}/retry`, { method: 'POST' })
      if (!response.ok) throw new Error(await readApiError(response))
      await load()
      await refreshProvider()
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : 'Retry failed.')
    } finally {
      setBusy(false)
    }
  }

  async function handleCancel() {
    if (!session) return
    setBusy(true)
    setActionError(null)
    try {
      const response = await fetch(`/api/import-export/migration-sessions/${session.id}/cancel`, { method: 'POST' })
      if (!response.ok) throw new Error(await readApiError(response))
      await load()
      await refreshProvider()
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : 'Cancel failed.')
    } finally {
      setBusy(false)
    }
  }

  if (loading && !session) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center p-6">
        <div className="text-center">
          <RefreshCw className="mx-auto mb-3 animate-spin text-indigo-500" />
          <p className="text-sm text-slate-600">Restoring migration from persisted session…</p>
        </div>
      </div>
    )
  }

  if (error || !session) {
    return (
      <div className="mx-auto max-w-lg space-y-4 p-6 text-center">
        <p role="alert" className="text-sm text-red-700">{error ?? 'Migration session not found'}</p>
        <button type="button" className="text-sm font-medium text-indigo-700 underline" onClick={() => router.push('/migration-history')}>
          Open Migration History
        </button>
      </div>
    )
  }

  return (
    <MigrationCenter
      session={session}
      busy={busy}
      actionError={actionError}
      onRetry={() => void handleRetry()}
      onCancel={() => void handleCancel()}
    />
  )
}
