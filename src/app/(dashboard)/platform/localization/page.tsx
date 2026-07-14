'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { PageHeader } from '@/components/ui/page-header'

interface LocaleSettings {
  locale: string
  timezone: string
  date_format: string
  number_format: string
  currency_display: string
}

interface Translation {
  namespace: string
  locale: string
  message_key: string
  message_value: string
}

export default function PlatformLocalizationPage() {
  const [settings, setSettings] = useState<LocaleSettings | null>(null)
  const [translations, setTranslations] = useState<Translation[]>([])

  useEffect(() => {
    fetch('/api/platform/localization')
      .then((r) => r.json())
      .then((d) => {
        setSettings(d.settings ?? null)
        setTranslations(d.translations ?? [])
      })
  }, [])

  return (
    <div className="p-6 max-w-[1100px] mx-auto space-y-6">
      <PageHeader
        title="Localization"
        subtitle="Languages, date/number formats, time zones, and translations"
        breadcrumb={[{ label: 'Platform' }, { label: 'Localization' }]}
        action={<Link href="/platform" className="text-sm text-indigo-600 hover:underline">← Platform</Link>}
      />
      {settings && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            ['Locale', settings.locale],
            ['Timezone', settings.timezone],
            ['Date format', settings.date_format],
            ['Number format', settings.number_format],
            ['Currency', settings.currency_display],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border p-4 text-center">
              <div className="text-xs text-muted-foreground">{label}</div>
              <div className="text-sm font-medium mt-1">{value}</div>
            </div>
          ))}
        </div>
      )}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-700">Translations</h2>
        <div className="rounded-xl border divide-y">
          {translations.length === 0 ? (
            <div className="p-6 text-center text-muted-foreground">No custom translations yet.</div>
          ) : translations.map((t) => (
            <div key={`${t.namespace}-${t.locale}-${t.message_key}`} className="p-4 text-sm">
              <div className="font-mono text-xs text-muted-foreground">{t.namespace}.{t.message_key} ({t.locale})</div>
              <div>{t.message_value}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
