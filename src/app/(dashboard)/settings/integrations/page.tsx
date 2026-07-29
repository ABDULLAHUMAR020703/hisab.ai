import Link from 'next/link'
import { ArrowLeft, Blocks } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { IntegrationsClient } from './integrations-client'

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ quickbooks?: string; message?: string }>
}) {
  const query = await searchParams
  const oauthFeedback = query.quickbooks === 'connected'
    ? { kind: 'connected' as const }
    : query.quickbooks === 'error'
      ? { kind: 'error' as const, message: query.message }
      : undefined
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <PageHeader
        title="Accounting Integrations"
        subtitle="Connect Hisab AI to your accounting platforms from one secure workspace."
        breadcrumb={[{ label: 'Administration' }, { label: 'Settings', href: '/settings' }, { label: 'Integrations' }]}
        action={
          <Link href="/settings" className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50">
            <ArrowLeft size={14} /> Settings
          </Link>
        }
      />
      <div className="flex items-start gap-4 rounded-2xl border border-indigo-100 bg-gradient-to-r from-indigo-50 to-white p-5">
        <div className="rounded-xl bg-indigo-600 p-2.5 text-white"><Blocks size={20} /></div>
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Your accounting ecosystem, in one place</h2>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-600">QuickBooks Online is available for connection setup. Additional providers are staged for future releases; importing and synchronization are intentionally not enabled in this phase.</p>
        </div>
      </div>
      <IntegrationsClient oauthFeedback={oauthFeedback} />
    </div>
  )
}
