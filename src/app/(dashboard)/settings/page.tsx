'use client'

import { useEffect, useState } from 'react'
import { Save, Building2, Shield, Palette } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import { CompanyLogoUpload } from '@/components/branding/company-logo-upload'
import { ZatcaConnectionManager } from '@/components/zatca/ZatcaConnectionManager'
import { ZATCA_BUSINESS_CATEGORIES } from '@/lib/zatca/business-categories'
import { stripLogoCacheBuster } from '@/lib/branding/logo-url'
import { readApiError } from '@/lib/api-client'
import { DEFAULT_CURRENCY, SUPPORTED_CURRENCIES, isSaudiArabia } from '@/lib/currency/constants'

interface Settings {
  companyName: string
  legalName: string
  taxId: string
  commercialRegistration: string
  address: string
  streetAddress: string
  buildingNumber: string
  district: string
  city: string
  postalCode: string
  country: string
  phone: string
  email: string
  website: string
  currency: string
  fiscalYearStart: string
  zatcaEnvironment: 'SANDBOX' | 'PRODUCTION'
  zatcaBusinessCategory: string
  logoUrl: string | null
  logoUploadedAt: string | null
}

interface OnboardingStatus {
  compliance?: {
    passed: boolean | null
    createdAt: string | null
    results: Array<{
      scenario: string
      passed: boolean
      validationStatus?: string
      error?: string
      requestId?: string
    }>
  }
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>({
    companyName: '',
    legalName: '',
    taxId: '',
    commercialRegistration: '',
    address: '',
    streetAddress: '',
    buildingNumber: '',
    district: '',
    city: '',
    postalCode: '',
    country: 'Saudi Arabia',
    phone: '',
    email: '',
    website: '',
    currency: DEFAULT_CURRENCY,
    fiscalYearStart: '01-01',
    zatcaEnvironment: 'SANDBOX',
    zatcaBusinessCategory: 'Telecommunications',
    logoUrl: null,
    logoUploadedAt: null,
  })
  const [onboarding, setOnboarding] = useState<OnboardingStatus | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    fetch('/api/settings')
      .then((r) => r.json())
      .then((d) => {
        if (!active || !d || d.error) return
        setSettings((s) => ({
          ...s,
          companyName: d.companyName ?? '',
          legalName: d.legalName ?? '',
          taxId: d.taxId ?? '',
          commercialRegistration: d.commercialRegistration ?? '',
          address: d.address ?? '',
          streetAddress: d.streetAddress ?? '',
          buildingNumber: d.buildingNumber ?? '',
          district: d.district ?? '',
          city: d.city ?? '',
          postalCode: d.postalCode ?? '',
          country: d.country ?? 'Saudi Arabia',
          phone: d.phone ?? '',
          email: d.email ?? '',
          website: d.website ?? '',
          currency: d.currency ?? DEFAULT_CURRENCY,
          fiscalYearStart: d.fiscalYearStart ?? '01-01',
          zatcaEnvironment: d.zatcaEnvironment === 'PRODUCTION' ? 'PRODUCTION' : 'SANDBOX',
          zatcaBusinessCategory: d.zatcaBusinessCategory ?? 'Telecommunications',
          logoUrl: stripLogoCacheBuster(d.logoUrl) ?? null,
          logoUploadedAt: d.logoUploadedAt
            ? typeof d.logoUploadedAt === 'string'
              ? d.logoUploadedAt
              : new Date(d.logoUploadedAt).toISOString()
            : null,
        }))
      })
      .catch(() => null)

    fetch('/api/zatca/onboarding/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (active && d) setOnboarding({ compliance: d.compliance })
      })
      .catch(() => null)

    return () => {
      active = false
    }
  }, [])

  async function handleSave() {
    setSaving(true)
    setSaved(false)
    setSaveError(null)

    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })

      if (!res.ok) {
        setSaveError(await readApiError(res))
        return
      }

      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  const f = (field: keyof Settings, val: string) => setSettings((s) => ({ ...s, [field]: val }))
  const isSaudi = isSaudiArabia(settings.country)

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <PageHeader
        title="Settings"
        subtitle={isSaudi ? 'Company information and ZATCA e-invoicing' : 'Company information and regional settings'}
        breadcrumb={[{ label: 'Administration' }, { label: 'Settings' }]}
        action={
          <div className="flex items-center gap-3">
            {saved && (
              <span className="text-sm text-emerald-600 font-medium bg-emerald-50 border border-emerald-200 px-3 py-1 rounded-lg">
                ✓ Saved
              </span>
            )}
            {saveError && (
              <span className="max-w-sm truncate text-sm text-red-600 font-medium bg-red-50 border border-red-200 px-3 py-1 rounded-lg" title={saveError}>
                {saveError}
              </span>
            )}
            <Button onClick={handleSave} loading={saving}>
              <Save size={15} /> Save Changes
            </Button>
          </div>
        }
      />

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-5">
        <div className="flex items-center gap-3 pb-4 border-b border-slate-100">
          <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center">
            <Building2 size={18} className="text-indigo-600" />
          </div>
          <div>
            <h2 className="font-semibold text-slate-900">Company Information</h2>
            <p className="text-xs text-slate-400">Legal identity and address details</p>
          </div>
        </div>
        <Input label="Company Name" required value={settings.companyName} onChange={(e) => f('companyName', e.target.value)} />
        <Input label="Legal Company Name" value={settings.legalName} onChange={(e) => f('legalName', e.target.value)} placeholder="As registered with ZATCA" />
        <div className="grid grid-cols-2 gap-4">
          <Input label="VAT Number (TRN)" required value={settings.taxId} onChange={(e) => f('taxId', e.target.value)} placeholder="3xxxxxxxxxxxxx3" />
          <Input label="Commercial Registration (CR)" required value={settings.commercialRegistration} onChange={(e) => f('commercialRegistration', e.target.value)} />
        </div>
        <Select
          label="ZATCA Business Category (CSR)"
          value={settings.zatcaBusinessCategory}
          onChange={(e) => f('zatcaBusinessCategory', e.target.value)}
          disabled={!isSaudi}
        >
          {ZATCA_BUSINESS_CATEGORIES.map((category) => (
            <option key={category} value={category}>{category}</option>
          ))}
        </Select>
        {isSaudi && (
          <p className="text-xs text-slate-400 -mt-3">Used when generating the CSR during onboarding. Save before connecting to ZATCA.</p>
        )}
        <div className="grid grid-cols-2 gap-4">
          <Input label="Building Number" required value={settings.buildingNumber} onChange={(e) => f('buildingNumber', e.target.value)} />
          <Input label="Street Address" value={settings.streetAddress} onChange={(e) => f('streetAddress', e.target.value)} />
        </div>
        <div className="grid grid-cols-3 gap-4">
          <Input label="District" value={settings.district} onChange={(e) => f('district', e.target.value)} />
          <Input label="City" required value={settings.city} onChange={(e) => f('city', e.target.value)} />
          <Input label="Postal Code" value={settings.postalCode} onChange={(e) => f('postalCode', e.target.value)} />
        </div>
        <Input label="Country" value={settings.country} onChange={(e) => f('country', e.target.value)} />
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-5">
        <div className="flex items-center gap-3 pb-4 border-b border-slate-100">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center">
            <Shield size={18} className="text-emerald-600" />
          </div>
          <div>
            <h2 className="font-semibold text-slate-900">Primary Currency</h2>
            <p className="text-xs text-slate-400">Used for dashboard totals, new transactions, and financial reports</p>
          </div>
        </div>
        <Select
          label="Primary Currency"
          value={settings.currency}
          onChange={(e) => f('currency', e.target.value)}
        >
          {SUPPORTED_CURRENCIES.map((entry) => (
            <option key={entry.code} value={entry.code}>{entry.code} — {entry.name}</option>
          ))}
        </Select>
        <p className="text-xs text-slate-400 -mt-3">
          All accounting is kept in this currency. Exchange-rate conversion is not applied in this release.
          {isSaudi ? ' ZATCA e-invoicing still requires SAR invoices at submission time.' : ''}
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-5">
        <div className="flex items-center gap-3 pb-4 border-b border-slate-100">
          <div className="w-10 h-10 rounded-xl bg-violet-50 flex items-center justify-center">
            <Palette size={18} className="text-violet-600" />
          </div>
          <div>
            <h2 className="font-semibold text-slate-900">Company Branding</h2>
            <p className="text-xs text-slate-400">Logo appears on invoices, credit notes, and future documents</p>
          </div>
        </div>

        <CompanyLogoUpload
          logoUrl={settings.logoUrl}
          logoUploadedAt={settings.logoUploadedAt}
          onLogoChange={({ logoUrl, logoUploadedAt }) => {
            setSettings((s) => ({
              ...s,
              logoUrl: stripLogoCacheBuster(logoUrl),
              logoUploadedAt,
            }))
          }}
        />

        <Input
          label="Website"
          value={settings.website}
          onChange={(e) => f('website', e.target.value)}
          placeholder="https://example.com"
        />
      </div>

      {isSaudi && (
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-5">
        <ZatcaConnectionManager
          onEnvironmentChange={(env) => setSettings((s) => ({ ...s, zatcaEnvironment: env }))}
        />

        <div className="rounded-xl border border-slate-200 p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Compliance Status</h3>
              <p className="text-xs text-slate-400">
                Latest ZATCA compliance invoice suite
                {onboarding?.compliance?.createdAt ? ` · ${new Date(onboarding.compliance.createdAt).toLocaleString()}` : ''}
              </p>
            </div>
            {onboarding?.compliance?.passed !== null && onboarding?.compliance?.passed !== undefined && (
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${onboarding.compliance.passed ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                {onboarding.compliance.passed ? 'PASS' : 'FAIL'}
              </span>
            )}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {(['STANDARD', 'SIMPLIFIED', 'CREDIT_NOTE', 'DEBIT_NOTE', 'STANDARD_CREDIT_NOTE', 'STANDARD_DEBIT_NOTE'] as const).map((scenario) => {
              const result = onboarding?.compliance?.results.find((item) => item.scenario === scenario)
              const label = scenario.replaceAll('_', ' ')
              const status = result?.validationStatus || (result?.passed ? 'PASS' : result ? 'FAIL' : 'NOT RUN')
              return (
                <div key={scenario} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-700">{label}</span>
                    <span className={result?.passed ? 'font-semibold text-emerald-600' : result ? 'font-semibold text-red-600' : 'font-semibold text-slate-400'}>
                      {status}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-slate-500" title={result?.error || result?.requestId || ''}>
                    {result?.error || result?.requestId || 'No result yet'}
                  </p>
                </div>
              )
            })}
          </div>
        </div>
      </div>
      )}
    </div>
  )
}
