'use client'

import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { RefreshCw } from 'lucide-react'
import { MigrationCenter } from '@/components/import-export/MigrationCenter'
import { useMigrationSession } from '@/components/import-export/MigrationSessionProvider'

/**
 * Persistent Migration Center page.
 * The layout provider is the sole polling and hydration owner. This page only
 * renders the provider snapshot for the session encoded in the route.
 */
export default function MigrationCenterPage() {
  const params = useParams<{ sessionId: string }>()
  const sessionId = params.sessionId
  const router = useRouter()
  const {
    session: contextSession,
    sessionLoading,
    sessionError,
    retrySession,
    cancelSession,
  } = useMigrationSession()
  const session = contextSession?.id === sessionId ? contextSession : null
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleRetry() {
    if (!session) return
    setBusy(true)
    setActionError(null)
    try {
      await retrySession(session.id)
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
      await cancelSession(session.id)
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : 'Cancel failed.')
    } finally {
      setBusy(false)
    }
  }

  if (sessionLoading || (!session && !sessionError)) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center p-6">
        <div className="text-center">
          <RefreshCw className="mx-auto mb-3 animate-spin text-indigo-500" />
          <p className="text-sm text-slate-600">Restoring migration from persisted session…</p>
        </div>
      </div>
    )
  }

  if (sessionError || !session) {
    return (
      <div className="mx-auto max-w-lg space-y-4 p-6 text-center">
        <p role="alert" className="text-sm text-red-700">{sessionError ?? 'Migration session not found'}</p>
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
