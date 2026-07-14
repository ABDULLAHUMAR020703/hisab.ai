'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { PageHeader } from '@/components/ui/page-header'

interface AutomationRule {
  id: string
  name: string
  event_type: string
  is_active: boolean
  priority?: number
}

export default function PlatformAutomationPage() {
  const [rules, setRules] = useState<AutomationRule[]>([])

  useEffect(() => {
    fetch('/api/platform/automation')
      .then((r) => r.json())
      .then((d) => setRules(d.rules ?? []))
  }, [])

  return (
    <div className="p-6 max-w-[1100px] mx-auto space-y-6">
      <PageHeader
        title="Automation Engine"
        subtitle="Database-driven event → condition → action rules"
        breadcrumb={[{ label: 'Platform' }, { label: 'Automation' }]}
        action={<Link href="/platform" className="text-sm text-indigo-600 hover:underline">← Platform</Link>}
      />
      <div className="rounded-xl border divide-y">
        {rules.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">No automation rules configured. Create rules via API or admin tools.</div>
        ) : rules.map((rule) => (
          <div key={rule.id} className="p-4 flex items-center justify-between hover:bg-slate-50">
            <div>
              <div className="font-medium">{rule.name}</div>
              <div className="text-xs text-muted-foreground">Event: {rule.event_type} · Priority {rule.priority ?? 0}</div>
            </div>
            <span className={`text-xs px-2 py-1 rounded-full ${rule.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
              {rule.is_active ? 'Active' : 'Inactive'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
