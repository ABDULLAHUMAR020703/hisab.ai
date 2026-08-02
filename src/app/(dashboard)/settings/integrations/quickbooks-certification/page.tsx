import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, BadgeCheck } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { isQuickBooksCertificationEnabled } from '@/lib/quickbooks-certification/feature'
import { QuickBooksCertificationClient } from './certification-client'

export default function QuickBooksCertificationPage(){if(!isQuickBooksCertificationEnabled())notFound();return <div className="mx-auto max-w-7xl space-y-6 p-6"><PageHeader title="QuickBooks Accounting Certification" subtitle="Mathematically reconcile QuickBooks financial reports with Hisab AI." breadcrumb={[{label:'Administration'},{label:'Settings',href:'/settings'},{label:'Integrations',href:'/settings/integrations'},{label:'Certification'}]} action={<Link href="/settings/integrations" className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"><ArrowLeft size={14}/> Integrations</Link>}/><div className="flex gap-4 rounded-2xl border border-indigo-100 bg-indigo-50 p-5"><BadgeCheck className="text-indigo-600"/><div><h2 className="font-semibold text-slate-900">Evidence-based certification</h2><p className="mt-1 text-xs text-slate-600">Unavailable reports and unexplained differences always fail certification. Every run stores parameters, hashes, comparisons, and reviewer state.</p></div></div><QuickBooksCertificationClient/></div>}
