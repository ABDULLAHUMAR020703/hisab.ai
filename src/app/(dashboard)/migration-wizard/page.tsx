'use client'

import { useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { useMigrationSession } from '@/components/import-export/MigrationSessionProvider'

/**
 * Configuration entry point only.
 * If a migration has already started, openViewer routes to Migration Center.
 */
export default function MigrationWizardPage() {
  const { openViewer, session, sessionLoading } = useMigrationSession()
  const openedRef = useRef(false)

  useEffect(() => {
    // Exactly one automatic open per mount: polling re-renders must not reopen
    // the wizard or restart a pending Migration Center transition.
    if (sessionLoading || openedRef.current) return
    openedRef.current = true
    openViewer()
  }, [openViewer, sessionLoading])

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold text-slate-900">Migration Wizard</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Configure your QuickBooks migration. Once started, progress continues in the Migration Center.
        </p>
        <Button className="mt-4" onClick={openViewer}>
          {session && session.config.state !== 'cancelled' ? 'Open Migration Center' : 'Configure Migration'}
        </Button>
      </div>
    </div>
  )
}
