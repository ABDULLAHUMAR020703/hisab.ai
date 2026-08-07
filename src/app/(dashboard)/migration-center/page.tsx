'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { Gauge } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { useMigrationSession } from '@/components/import-export/MigrationSessionProvider'
import { MigrationCenterSkeleton } from '@/components/import-export/MigrationCenter'

/**
 * Sidebar entry for Migration Center.
 * Resumes the latest hydrated session (works after refresh) or shows an empty
 * state when no migration exists yet. Session-scoped URLs remain
 * /migration-center/[sessionId].
 */
export default function MigrationCenterIndexPage() {
  const { session, sessionLoading, openMigrationCenter } = useMigrationSession()
  const redirectedRef = useRef(false)

  useEffect(() => {
    if (sessionLoading || redirectedRef.current || !session) return
    redirectedRef.current = true
    openMigrationCenter(session.id)
  }, [openMigrationCenter, session, sessionLoading])

  if (sessionLoading || session) {
    return <MigrationCenterSkeleton />
  }

  return (
    <div className="mx-auto max-w-lg space-y-6 p-6" data-migration-center-index>
      <PageHeader
        title="Migration Center"
        subtitle="Live progress for QuickBooks migrations"
        breadcrumb={[{ label: 'Administration' }, { label: 'Migration Center' }]}
      />
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
          <Gauge size={22} aria-hidden="true" />
        </span>
        <h2 className="mt-4 text-lg font-semibold text-slate-900">No migration to resume</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Start a migration from the Wizard, or open a past run from Migration History.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/migration-wizard"
            className="inline-flex h-9 items-center rounded-lg bg-indigo-600 px-4 text-sm font-medium text-white shadow-sm shadow-indigo-200 hover:bg-indigo-700"
          >
            Open Migration Wizard
          </Link>
          <Link
            href="/migration-history"
            className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Migration History
          </Link>
        </div>
      </div>
    </div>
  )
}
