import Link from 'next/link'
import { ArrowLeft, ShieldCheck } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { QuickBooksValidationClient } from './validation-client'

export default function QuickBooksValidationPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <PageHeader
        title="QuickBooks Import Validation"
        subtitle="Compare live QuickBooks records with imported Hisab AI data, field by field."
        breadcrumb={[
          { label: 'Administration' },
          { label: 'Settings', href: '/settings' },
          { label: 'Integrations', href: '/settings/integrations' },
          { label: 'Validation' },
        ]}
        action={
          <Link href="/settings/integrations" className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50">
            <ArrowLeft size={14} /> Integrations
          </Link>
        }
      />
      <div className="flex items-start gap-4 rounded-2xl border border-indigo-100 bg-gradient-to-r from-indigo-50 to-white p-5">
        <div className="rounded-xl bg-indigo-600 p-2.5 text-white"><ShieldCheck size={20} /></div>
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Exact-source verification</h2>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-600">Each run fetches current QuickBooks data and compares it with the tenant&apos;s imported records. A single discrepancy fails the suite.</p>
        </div>
      </div>
      <QuickBooksValidationClient />
    </div>
  )
}
