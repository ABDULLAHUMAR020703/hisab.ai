'use client'

import { useRouter } from 'next/navigation'
import { ConnectedSourceFlow } from '@/components/import-export/steps/ConnectedSourceFlow'

/** Central migration entry point. The source-driven wizard owns the full migration lifecycle. */
export default function MigrationWizardPage() {
  const router = useRouter()
  return (
    <ConnectedSourceFlow
      open
      initialSource="quickbooks"
      onClose={() => router.push('/settings/integrations')}
    />
  )
}
