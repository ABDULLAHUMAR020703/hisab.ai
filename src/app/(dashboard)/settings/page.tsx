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
  zatcaEnvironment: 'SANDBOX' | 'PRODUCTION'
}

interface OnboardingStatus {
  zatcaConnected: boolean
  environment: 'SANDBOX' | 'PRODUCTION'
  connectionStatus: 'NOT_CONNECTED' | 'PENDING' | 'CONNECTED' | 'FAILED'
  onboardingStatus: string
  onboardedAt: string | null
  lastError: string | null
}

const CONNECTION_BADGES: Record<OnboardingStatus['connectionStatus'], { label: string; className: string }> = {
  NOT_CONNECTED: { label: 'Not Connected', className: 'bg-slate-100 text-slate-700' },
  PENDING: { label: 'Connecting…', className: 'bg-amber-100 text-amber-800' },
  CONNECTED: { label: 'Connected', className: 'bg-emerald-100 text-emerald-800' },
  FAILED: { label: 'Failed', className: 'bg-red-100 text-red-700' },
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
    currency: 'SAR',
    fiscalYearStart: '01-01',
    zatcaEnvironment: 'SANDBOX',
  })
  const [onboarding, setOnboarding] = useState<OnboardingStatus | null>(null)
  const [otp, setOtp] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [onboardingMsg, setOnboardingMsg] = useState<string | null>(null)
  const [onboardingErr, setOnboardingErr] = useState<string | null>(null)

  const loadOnboardingStatus = useCallback(async () => {
    const res = await fetch('/api/zatca/onboarding/status')
    if (res.ok) setOnboarding(await res.json())
  }, [])

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((d) => {
        if (!d || d.error) return
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
          currency: d.currency ?? 'SAR',
          fiscalYearStart: d.fiscalYearStart ?? '01-01',
          zatcaEnvironment: d.zatcaEnvironment === 'PRODUCTION' ? 'PRODUCTION' : 'SANDBOX',
        }))
      })
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
    }
    setSaving(false)
  }

  async function handleConnectZatca() {
    setConnecting(true)
    setOnboardingMsg(null)
    setOnboardingErr(null)

    try {
      if (!otp.trim()) {
        setOnboardingErr('Enter the OTP from the Fatoora portal.')
        return
      }

      const saveRes = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...settings, zatcaEnabled: true }),
      })
      if (!saveRes.ok) {
        const data = await saveRes.json()
        throw new Error(data.error || 'Failed to save company profile')
      }

      setOnboardingMsg('Connecting to ZATCA… generating keys, CSR, and requesting CSID. This may take a minute.')

      const res = await fetch('/api/zatca/onboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          otp,
          environment: settings.zatcaEnvironment,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'ZATCA connection failed')

      const warnings: string[] = Array.isArray(data.warnings) ? data.warnings : []
      if (warnings.length) {
        setOnboardingMsg(
          `Connected to ZATCA — Compliance CSID issued. Some follow-up steps were deferred: ${warnings.join(' | ')}`,
        )
      } else {
        setOnboardingMsg('Connected to ZATCA. Compliance checks and production CSID completed successfully.')
      }
      setOtp('')
      await loadOnboardingStatus()
    } catch (err) {
      setOnboardingErr(err instanceof Error ? err.message : String(err))
      await loadOnboardingStatus()
    } finally {
      setConnecting(false)
    }
  }

  const f = (field: keyof Settings, val: string) => setSettings((s) => ({ ...s, [field]: val }))

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <PageHeader
        title="Settings"
        subtitle="Company information and ZATCA e-invoicing"
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
            <p className="text-xs text-slate-400">Required for ZATCA CSR and compliance</p>
          </div>
        </div>
        <Input label="Company Name" required value={settings.companyName} onChange={(e) => f('companyName', e.target.value)} />
        <Input label="Legal Company Name" value={settings.legalName} onChange={(e) => f('legalName', e.target.value)} placeholder="As registered with ZATCA" />
        <div className="grid grid-cols-2 gap-4">
          <Input label="VAT Number (TRN)" required value={settings.taxId} onChange={(e) => f('taxId', e.target.value)} placeholder="3xxxxxxxxxxxxx3" />
          <Input label="Commercial Registration (CR)" required value={settings.commercialRegistration} onChange={(e) => f('commercialRegistration', e.target.value)} />
        </div>
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
            <h2 className="font-semibold text-slate-900">Saudi E-Invoicing (ZATCA)</h2>
            <p className="text-xs text-slate-400">
              Log in to the Fatoora portal, generate an OTP, paste it below, and click Connect.
            </p>
          </div>
        </div>

        <Select
          label="Environment"
          value={settings.zatcaEnvironment}
          onChange={(e) => f('zatcaEnvironment', e.target.value)}
        >
          <option value="SANDBOX">Simulation (Sandbox)</option>
          <option value="PRODUCTION">Production</option>
        </Select>

        {onboarding && (
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 text-sm flex flex-wrap items-center gap-2">
            <span className="font-medium text-slate-700">Status</span>
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${CONNECTION_BADGES[onboarding.connectionStatus].className}`}>
              {CONNECTION_BADGES[onboarding.connectionStatus].label}
            </span>
            {onboarding.zatcaConnected && onboarding.onboardedAt && (
              <span className="text-xs text-slate-500">
                since {new Date(onboarding.onboardedAt).toLocaleDateString()} ({onboarding.environment})
              </span>
            )}
            {onboarding.lastError && (
              <p className="w-full text-red-600 text-xs mt-1">{onboarding.lastError}</p>
            )}
          </div>
        )}

        <Input
          label="OTP from Fatoora Portal"
          value={otp}
          onChange={(e) => setOtp(e.target.value)}
          placeholder="e.g. 213710"
        />
        <p className="text-xs text-slate-400 -mt-3">
          In the Fatoora portal: create or select your EGS unit → Generate OTP → paste here.
          hisab.ai handles keys, CSR, and certificate automatically.
        </p>

        <Button onClick={handleConnectZatca} loading={connecting} className="w-full sm:w-auto">
          {connecting ? <Loader2 size={15} className="animate-spin" /> : <Link2 size={15} />}
          Connect to ZATCA
        </Button>

        {onboardingMsg && <p className="text-sm text-emerald-600">{onboardingMsg}</p>}
        {onboardingErr && <p className="text-sm text-red-600">{onboardingErr}</p>}
      </div>
    </div>
  )
}


