'use client'

import { useCallback, useEffect, useState } from 'react'
import { Save, Building2, Shield, Link2, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'

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
  currency: string
  fiscalYearStart: string
  zatcaEnabled: boolean
  zatcaEnvironment: 'SANDBOX' | 'PRODUCTION'
}

interface OnboardingStatus {
  zatcaEnabled: boolean
  environment: 'SANDBOX' | 'PRODUCTION'
  onboardingStatus: string
  hasCsr: boolean
  hasCertificate: boolean
  hasComplianceCsid: boolean
  hasProductionCsid: boolean
  onboardedAt: string | null
  lastError: string | null
}

const STATUS_LABELS: Record<string, string> = {
  NOT_STARTED: 'Not started',
  CSR_GENERATED: 'CSR generated',
  COMPLIANCE_ISSUED: 'Compliance CSID issued',
  PRODUCTION_ISSUED: 'Production CSID issued',
  FAILED: 'Failed',
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>({
    companyName: 'NETKOM COMPANY FOR COMMUNICATION',
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
    currency: 'SAR',
    fiscalYearStart: '01-01',
    zatcaEnabled: false,
    zatcaEnvironment: 'SANDBOX',
  })
  const [onboarding, setOnboarding] = useState<OnboardingStatus | null>(null)
  const [otp, setOtp] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [onboardingMsg, setOnboardingMsg] = useState<string | null>(null)
  const [onboardingErr, setOnboardingErr] = useState<string | null>(null)
  const [requestingProduction, setRequestingProduction] = useState(false)

  const loadOnboardingStatus = useCallback(async () => {
    const res = await fetch('/api/zatca/onboarding/status')
    if (res.ok) setOnboarding(await res.json())
  }, [])

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((d) => { if (d) setSettings((s) => ({ ...s, ...d })) })
      .catch(() => null)
    loadOnboardingStatus()
  }, [loadOnboardingStatus])

  async function handleSave() {
    setSaving(true)
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    })
    if (res.ok) {
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
      await loadOnboardingStatus()
    }
    setSaving(false)
  }

  async function handleRequestProductionCsid() {
    setRequestingProduction(true)
    setOnboardingMsg(null)
    setOnboardingErr(null)
    try {
      const res = await fetch('/api/zatca/onboarding/production', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Production CSID request failed')
      setOnboardingMsg(`Production CSID issued (${data.dispositionMessage}).`)
      await loadOnboardingStatus()
    } catch (err) {
      setOnboardingErr(err instanceof Error ? err.message : String(err))
    } finally {
      setRequestingProduction(false)
    }
  }

  async function handleConnectZatca() {
    setConnecting(true)
    setOnboardingMsg(null)
    setOnboardingErr(null)

    try {
      if (!onboarding?.hasCsr) {
        const csrRes = await fetch('/api/zatca/onboarding/csr', { method: 'POST' })
        const csrData = await csrRes.json()
        if (!csrRes.ok) throw new Error(csrData.error || 'CSR generation failed')

        if (!otp.trim()) {
          setOnboardingMsg(`CSR generated for ${csrData.commonName}. Enter OTP from ZATCA Fatoora portal, then click Connect again.`)
          await loadOnboardingStatus()
          return
        }
      }

      if (!otp.trim()) {
        setOnboardingErr('OTP is required to complete ZATCA compliance onboarding.')
        return
      }

      const complianceRes = await fetch('/api/zatca/onboarding/compliance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ otp }),
      })
      const complianceData = await complianceRes.json()
      if (!complianceRes.ok) throw new Error(complianceData.error || 'Compliance onboarding failed')

      setOnboardingMsg(`ZATCA compliance CSID issued (${complianceData.dispositionMessage}).`)
      setOtp('')
      await loadOnboardingStatus()
    } catch (err) {
      setOnboardingErr(err instanceof Error ? err.message : String(err))
      await loadOnboardingStatus()
    } finally {
      setConnecting(false)
    }
  }

  const f = (field: keyof Settings, val: string | boolean) => setSettings((s) => ({ ...s, [field]: val }))

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <PageHeader
        title="Settings"
        subtitle="Company information and system configuration"
        breadcrumb={[{ label: 'Administration' }, { label: 'Settings' }]}
        action={
          <div className="flex items-center gap-3">
            {saved && (
              <span className="text-sm text-emerald-600 font-medium bg-emerald-50 border border-emerald-200 px-3 py-1 rounded-lg">
                ✓ Saved
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
            <p className="text-xs text-slate-400">Legal and billing details</p>
          </div>
        </div>
        <Input label="Company Name" required value={settings.companyName} onChange={(e) => f('companyName', e.target.value)} />
        <Input label="Legal Name" value={settings.legalName} onChange={(e) => f('legalName', e.target.value)} />
        <div className="grid grid-cols-2 gap-4">
          <Input label="Tax ID (VAT TRN)" value={settings.taxId} onChange={(e) => f('taxId', e.target.value)} placeholder="3xxxxxxxxxxxxx3" />
          <Input label="Commercial Registration (CRN)" value={settings.commercialRegistration} onChange={(e) => f('commercialRegistration', e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Input label="Email" type="email" value={settings.email} onChange={(e) => f('email', e.target.value)} />
          <Input label="Phone" value={settings.phone} onChange={(e) => f('phone', e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Input label="Building Number" value={settings.buildingNumber} onChange={(e) => f('buildingNumber', e.target.value)} />
          <Input label="Street Address" value={settings.streetAddress} onChange={(e) => f('streetAddress', e.target.value)} />
        </div>
        <div className="grid grid-cols-3 gap-4">
          <Input label="District" value={settings.district} onChange={(e) => f('district', e.target.value)} />
          <Input label="City" value={settings.city} onChange={(e) => f('city', e.target.value)} />
          <Input label="Postal Code" value={settings.postalCode} onChange={(e) => f('postalCode', e.target.value)} />
        </div>
        <Input label="Address (legacy)" value={settings.address} onChange={(e) => f('address', e.target.value)} />
        <Input label="Country" value={settings.country} onChange={(e) => f('country', e.target.value)} />
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-5">
        <div className="pb-4 border-b border-slate-100">
          <h2 className="font-semibold text-slate-900">Financial Settings</h2>
          <p className="text-xs text-slate-400">Currency and fiscal year configuration</p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Select label="Currency" value={settings.currency} onChange={(e) => f('currency', e.target.value)}>
            <option value="SAR">SAR — Saudi Riyal</option>
            <option value="USD">USD — US Dollar</option>
            <option value="EUR">EUR — Euro</option>
            <option value="AED">AED — UAE Dirham</option>
          </Select>
          <Input label="Fiscal Year Start (MM-DD)" value={settings.fiscalYearStart} onChange={(e) => f('fiscalYearStart', e.target.value)} placeholder="01-01" />
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-5">
        <div className="flex items-center gap-3 pb-4 border-b border-slate-100">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center">
            <Shield size={18} className="text-emerald-600" />
          </div>
          <div>
            <h2 className="font-semibold text-slate-900">Saudi E-Invoicing (ZATCA)</h2>
            <p className="text-xs text-slate-400">Phase 2 compliance onboarding and environment</p>
          </div>
        </div>

        <label className="flex items-start gap-3 cursor-pointer group">
          <div className="relative mt-0.5">
            <input
              type="checkbox"
              checked={settings.zatcaEnabled}
              onChange={(e) => f('zatcaEnabled', e.target.checked)}
              className="sr-only"
            />
            <div className={`w-10 h-6 rounded-full transition-colors ${settings.zatcaEnabled ? 'bg-indigo-600' : 'bg-slate-200'}`}>
              <div className={`w-4 h-4 bg-white rounded-full shadow-sm absolute top-1 transition-transform ${settings.zatcaEnabled ? 'translate-x-5' : 'translate-x-1'}`} />
            </div>
          </div>
          <div>
            <p className="text-sm font-medium text-slate-700">Enable Saudi E-Invoicing</p>
            <p className="text-xs text-slate-400 mt-0.5">Enable ZATCA XML, hash, QR, and onboarding workflows</p>
          </div>
        </label>

        <Select
          label="ZATCA Environment"
          value={settings.zatcaEnvironment}
          onChange={(e) => f('zatcaEnvironment', e.target.value)}
        >
          <option value="SANDBOX">Sandbox (Simulation)</option>
          <option value="PRODUCTION">Production</option>
        </Select>

        {onboarding && (
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 text-sm space-y-2">
            <p className="font-medium text-slate-700">Onboarding Status</p>
            <p className="text-slate-600">
              {STATUS_LABELS[onboarding.onboardingStatus] ?? onboarding.onboardingStatus}
            </p>
            <div className="flex flex-wrap gap-2 text-xs">
              {onboarding.hasCsr && <span className="px-2 py-0.5 rounded bg-indigo-100 text-indigo-700">CSR</span>}
              {onboarding.hasCertificate && <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-700">Certificate</span>}
              {onboarding.hasComplianceCsid && <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-700">Compliance CSID</span>}
              {onboarding.hasProductionCsid && <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-700">Production CSID</span>}
            </div>
            {onboarding.lastError && (
              <p className="text-red-600 text-xs">{onboarding.lastError}</p>
            )}
          </div>
        )}

        <div className="space-y-3 pt-2 border-t border-slate-100">
          <Input
            label="ZATCA OTP"
            value={otp}
            onChange={(e) => setOtp(e.target.value)}
            placeholder="Enter OTP from Fatoora portal"
          />
          <p className="text-xs text-slate-400">
            Obtain OTP from the ZATCA Fatoora simulation portal. For local dev, set{' '}
            <code className="bg-slate-100 px-1 rounded">ZATCA_MOCK_ONBOARDING=true</code>.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={handleConnectZatca} loading={connecting} disabled={!settings.zatcaEnabled}>
              {connecting ? <Loader2 size={15} className="animate-spin" /> : <Link2 size={15} />}
              Connect to ZATCA
            </Button>
            {onboarding?.hasComplianceCsid && !onboarding?.hasProductionCsid && (
              <Button variant="outline" onClick={handleRequestProductionCsid} loading={requestingProduction} disabled={!settings.zatcaEnabled}>
                Request Production CSID
              </Button>
            )}
          </div>
          {onboardingMsg && <p className="text-sm text-emerald-600">{onboardingMsg}</p>}
          {onboardingErr && <p className="text-sm text-red-600">{onboardingErr}</p>}
        </div>
      </div>
    </div>
  )
}
