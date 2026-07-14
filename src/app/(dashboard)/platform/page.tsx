'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  Bell, Briefcase, FileText, Flag, Globe, Hash, Plug, Search, Webhook, Zap, Cog,
} from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { Input } from '@/components/ui/input'

const SERVICES = [
  { title: 'Notifications', description: 'In-app, email, SMS, push, preferences', href: '/notifications', icon: Bell, color: 'text-indigo-600', bg: 'bg-indigo-50' },
  { title: 'Documents', description: 'Versioning, tags, OCR, comments, retention', href: '/platform/documents', icon: FileText, color: 'text-violet-600', bg: 'bg-violet-50' },
  { title: 'Global Search', description: 'Search across all ERP entities', href: '/platform/search', icon: Search, color: 'text-sky-600', bg: 'bg-sky-50' },
  { title: 'Automations', description: 'Event → condition → action rules', href: '/platform/automation', icon: Zap, color: 'text-amber-600', bg: 'bg-amber-50' },
  { title: 'Webhooks', description: 'Outgoing/incoming with signing & replay', href: '/platform/webhooks', icon: Webhook, color: 'text-rose-600', bg: 'bg-rose-50' },
  { title: 'API Keys', description: 'Scopes, rate limits, usage logs', href: '/platform/api-keys', icon: Briefcase, color: 'text-emerald-600', bg: 'bg-emerald-50' },
  { title: 'Integrations', description: 'QuickBooks, Stripe, Twilio, and more', href: '/platform/integrations', icon: Plug, color: 'text-cyan-600', bg: 'bg-cyan-50' },
  { title: 'Feature Flags', description: 'Company, branch, user rollout', href: '/platform/feature-flags', icon: Flag, color: 'text-fuchsia-600', bg: 'bg-fuchsia-50' },
  { title: 'Numbering', description: 'Configurable document series', href: '/platform/numbering', icon: Hash, color: 'text-orange-600', bg: 'bg-orange-50' },
  { title: 'Job Queue', description: 'Background jobs, retry, dead-letter', href: '/platform/jobs', icon: Cog, color: 'text-slate-600', bg: 'bg-slate-100' },
  { title: 'Localization', description: 'Languages, formats, translations', href: '/platform/localization', icon: Globe, color: 'text-teal-600', bg: 'bg-teal-50' },
]

export default function PlatformHubPage() {
  return (
    <div className="p-6 max-w-[1600px] mx-auto space-y-6">
      <PageHeader
        title="Platform Services"
        subtitle="Shared ERP infrastructure for all modules — additive and backward compatible"
        breadcrumb={[{ label: 'Administration' }, { label: 'Platform' }]}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {SERVICES.map((s) => {
          const Icon = s.icon
          return (
            <Link key={s.href} href={s.href}
              className="group bg-white rounded-2xl border border-slate-200 shadow-sm p-6 hover:shadow-md hover:border-indigo-200 transition-all"
            >
              <div className={`w-12 h-12 rounded-2xl ${s.bg} flex items-center justify-center mb-4`}>
                <Icon size={22} className={s.color} />
              </div>
              <h3 className="font-semibold text-slate-900 mb-1 group-hover:text-indigo-600 transition-colors">{s.title}</h3>
              <p className="text-sm text-slate-500">{s.description}</p>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
