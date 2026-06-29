'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Eye, Loader2, RefreshCw, Shield, Trash2, Wifi } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

type ZatcaEnvironment = 'SANDBOX' | 'PRODUCTION'

interface CertificateItem {
  kind: 'COMPLIANCE' | 'PRODUCTION'
  status: 'VALID' | 'EXPIRING_SOON' | 'EXPIRED' | 'MISSING'
  issuedAt: string | null
  validFrom: string | null
  validTo: string | null
  daysRemaining: number | null
}

interface Props {
  onEnvironmentChange: (env: ZatcaEnvironment) => void
}

interface EnvironmentConnectionView {
  environment: ZatcaEnvironment
  connected: boolean
  resumeStage: string
  complianceCsid: string | null
  productionCsid: string | null
  status: {
    connectionStatus: string
    onboardingStatus: string
    lastError: string | null
  }
  certificates: {
    compliance: CertificateItem
    production: CertificateItem
  }
  lastConnectionTest: {
    at: string
    ok: boolean
    message: string
  } | null
}

interface ConnectionSnapshot {
  activeEnvironment: ZatcaEnvironment
  simulation: EnvironmentConnectionView
  production: EnvironmentConnectionView
}

function maskCsid(value: string | null) {
  if (!value) return '—'
  if (value.length <= 8) return value
  return `${value.slice(0, 4)}…${value.slice(-4)}`
}

function expiryBanner(cert: CertificateItem) {
  if (cert.status === 'MISSING' || cert.daysRemaining === null) return null
  if (cert.status === 'EXPIRED' || cert.daysRemaining <= 0) {
    return { tone: 'critical', text: 'Certificate expired. Renew before submitting invoices.' }
  }
  if (cert.daysRemaining <= 7) {
    return { tone: 'critical', text: `Certificate expires in ${cert.daysRemaining} day(s).` }
  }
  if (cert.daysRemaining <= 15) {
    return { tone: 'warning', text: `Certificate expires in ${cert.daysRemaining} day(s).` }
  }
  if (cert.daysRemaining <= 30) {
    return { tone: 'caution', text: `Certificate expires in ${cert.daysRemaining} day(s).` }
  }
  return null
}

function EnvCard({
  title,
  view,
  isActive,
  onTest,
  onResume,
  onDelete,
  onOnboard,
  onRenew,
  testing,
  busy,
  showReOnboard,
  showStartOnboarding,
  canManage,
  canDelete,
}: {
  title: string
  view: EnvironmentConnectionView
  showReOnboard?: boolean
  showStartOnboarding?: boolean
  isActive: boolean
  onTest: () => void
  onResume: () => void
  onDelete: () => void
  onOnboard: () => void
  onRenew: () => void
  testing: boolean
  busy: boolean
  canManage: boolean
  canDelete: boolean
}) {
  const [showDetails, setShowDetails] = useState(false)
  const prodCert = view.certificates.production
  const activeCert = prodCert.validTo ? prodCert : view.certificates.compliance
  const alert = expiryBanner(activeCert)

  return (
    <div className={cn('rounded-xl border p-4 space-y-4', isActive ? 'border-indigo-300 bg-indigo-50/40' : 'border-slate-200 bg-white')}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-slate-900">{title}</h3>
          <p className="text-xs text-slate-500">{isActive ? 'Active environment' : 'Inactive environment'}</p>
        </div>
        <span className={cn(
          'px-2 py-0.5 rounded text-xs font-semibold',
          view.connected ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600',
        )}>
          {view.connected ? 'Connected' : 'Not Connected'}
        </span>
      </div>

      {alert && (
        <div className={cn(
          'rounded-lg border px-3 py-2 text-xs font-medium flex items-start gap-2',
          alert.tone === 'critical' && 'border-red-200 bg-red-50 text-red-700',
          alert.tone === 'warning' && 'border-orange-200 bg-orange-50 text-orange-800',
          alert.tone === 'caution' && 'border-amber-200 bg-amber-50 text-amber-800',
        )}>
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
          {alert.text}
        </div>
      )}

      <dl className="grid gap-2 text-sm">
        <div className="flex justify-between gap-4"><dt className="text-slate-500">Compliance CSID</dt><dd className="font-mono text-xs">{maskCsid(view.complianceCsid)}</dd></div>
        <div className="flex justify-between gap-4"><dt className="text-slate-500">Production CSID</dt><dd className="font-mono text-xs">{maskCsid(view.productionCsid)}</dd></div>
        <div className="flex justify-between gap-4"><dt className="text-slate-500">Certificate created</dt><dd>{activeCert.issuedAt ? new Date(activeCert.issuedAt).toLocaleDateString() : '—'}</dd></div>
        <div className="flex justify-between gap-4"><dt className="text-slate-500">Certificate expiry</dt><dd>{activeCert.validTo ? new Date(activeCert.validTo).toLocaleDateString() : '—'}</dd></div>
        <div className="flex justify-between gap-4"><dt className="text-slate-500">Last connection test</dt><dd className="text-right text-xs">{view.lastConnectionTest ? `${view.lastConnectionTest.ok ? 'OK' : 'Failed'} · ${new Date(view.lastConnectionTest.at).toLocaleString()}` : 'Never'}</dd></div>
        <div className="flex justify-between gap-4"><dt className="text-slate-500">Onboarding stage</dt><dd className="text-xs">{view.resumeStage.replaceAll('_', ' ')}</dd></div>
      </dl>

      {view.status.lastError && (
        <p className="text-xs text-red-600">{view.status.lastError}</p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={onTest} loading={testing} disabled={busy || !canManage}>
          <Wifi size={14} /> Test Connection
        </Button>
        {!view.connected && showStartOnboarding && canManage && (
          <Button size="sm" onClick={onOnboard} disabled={busy}>
            Start Production Onboarding
          </Button>
        )}
        {showReOnboard && canManage && (
          <Button variant="outline" size="sm" onClick={onOnboard} disabled={busy}>
            Re-onboard Simulation
          </Button>
        )}
        {view.connected && canManage && (
          <Button variant="outline" size="sm" onClick={onRenew} disabled={busy}>Renew Certificate</Button>
        )}
        {(view.resumeStage === 'NEEDS_COMPLIANCE_CHECKS' || view.resumeStage === 'NEEDS_PRODUCTION_CSID') && canManage && (
          <Button size="sm" onClick={onResume} disabled={busy}>Resume Onboarding</Button>
        )}
        <Button variant="outline" size="sm" onClick={() => setShowDetails((v) => !v)}>
          <Eye size={14} /> {showDetails ? 'Hide Details' : 'View Details'}
        </Button>
        {canDelete && (
          <Button variant="outline" size="sm" onClick={onDelete} disabled={busy} className="text-red-600 border-red-200 hover:bg-red-50">
            <Trash2 size={14} /> Delete Local Credentials
          </Button>
        )}
      </div>

      {showDetails && (
        <div className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-xs space-y-2">
          <p><span className="font-semibold">Compliance cert:</span> {view.certificates.compliance.validTo ? `valid to ${new Date(view.certificates.compliance.validTo).toLocaleString()}` : 'not available'}</p>
          <p><span className="font-semibold">Production cert:</span> {view.certificates.production.validTo ? `valid to ${new Date(view.certificates.production.validTo).toLocaleString()}` : 'not available'}</p>
          <p><span className="font-semibold">Status:</span> {view.status.onboardingStatus}</p>
          {view.lastConnectionTest?.message && (
            <p><span className="font-semibold">Last test:</span> {view.lastConnectionTest.message}</p>
          )}
        </div>
      )}
    </div>
  )
}

export function ZatcaConnectionManager({ onEnvironmentChange }: Props) {
  const [snapshot, setSnapshot] = useState<ConnectionSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [testingEnv, setTestingEnv] = useState<ZatcaEnvironment | null>(null)
  const [busy, setBusy] = useState(false)
  const [otp, setOtp] = useState('')
  const [onboardEnv, setOnboardEnv] = useState<ZatcaEnvironment | null>(null)
  const [deleteEnv, setDeleteEnv] = useState<ZatcaEnvironment | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState('')
  const [userRole, setUserRole] = useState<string | null>(null)

  const canManage = userRole === 'OWNER' || userRole === 'ADMIN'
  const canDelete = userRole === 'OWNER'

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/zatca/connection')
      if (res.ok) setSnapshot(await res.json())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setUserRole(d?.role ?? null))
      .catch(() => null)
  }, [])

  async function switchEnvironment(env: ZatcaEnvironment) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/zatca/connection/environment', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ environment: env }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to switch environment')
      onEnvironmentChange(env)
      await load()
      setMessage(`Active environment switched to ${env === 'SANDBOX' ? 'Simulation' : 'Production'}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function testConnection(env: ZatcaEnvironment) {
    setTestingEnv(env)
    setError(null)
    try {
      const res = await fetch('/api/zatca/onboarding/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ environment: env }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || data.message || 'Connection test failed')
      setMessage(data.message)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setTestingEnv(null)
    }
  }

  async function resumeOnboarding(env: ZatcaEnvironment) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/zatca/connection/resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ environment: env }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || data.message || 'Resume failed')
      setMessage(data.message || 'Onboarding resumed successfully.')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function runOnboard() {
    if (!onboardEnv || !otp.trim()) {
      setError('Enter the OTP from the Fatoora portal.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/zatca/onboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ otp, environment: onboardEnv }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Onboarding failed')
      setMessage(data.warnings?.length ? `Connected with warnings: ${data.warnings.join(' | ')}` : 'ZATCA onboarding completed.')
      setOtp('')
      setOnboardEnv(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function startRenew(env: ZatcaEnvironment) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/zatca/connection/renew', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ environment: env }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to start renewal')
      setMessage(data.message)
      setDeleteEnv(env)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function confirmDelete() {
    if (!deleteEnv) return
    if (deleteConfirm !== 'DELETE') {
      setError('Type DELETE to confirm credential removal.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/zatca/connection/delete-credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ environment: deleteEnv, confirm: true }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to delete credentials')
      setMessage('Local credentials deleted. Invoices and audit history were not modified.')
      setDeleteEnv(null)
      setDeleteConfirm('')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  if (loading && !snapshot) {
    return <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" /> Loading ZATCA connection manager…</div>
  }

  const active = snapshot?.activeEnvironment ?? 'SANDBOX'

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center">
            <Shield size={18} className="text-emerald-600" />
          </div>
          <div>
            <h2 className="font-semibold text-slate-900">ZATCA Connection Manager</h2>
            <p className="text-xs text-slate-400">Manage simulation and production credentials separately</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </Button>
      </div>

      <div className="inline-flex rounded-xl border border-slate-200 p-1 bg-slate-50">
        {(['SANDBOX', 'PRODUCTION'] as const).map((env) => (
          <button
            key={env}
            type="button"
            onClick={() => canManage && switchEnvironment(env)}
            disabled={busy || active === env || !canManage}
            className={cn(
              'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
              active === env ? 'bg-white shadow text-indigo-700' : 'text-slate-600 hover:text-slate-900',
            )}
          >
            {env === 'SANDBOX' ? 'Simulation' : 'Production'}
            {active === env && <span className="ml-2 text-[10px] uppercase tracking-wide text-indigo-500">Active</span>}
          </button>
        ))}
      </div>

      {message && <p className="text-sm text-emerald-600">{message}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!canManage && (
        <p className="text-sm text-slate-500">Only company owners and administrators can manage ZATCA connections. You can view status below.</p>
      )}

      {snapshot && (
        <div className="grid gap-4 lg:grid-cols-2">
          <EnvCard
            title="Simulation Environment"
            view={snapshot.simulation}
            isActive={active === 'SANDBOX'}
            showReOnboard
            onTest={() => testConnection('SANDBOX')}
            onResume={() => resumeOnboarding('SANDBOX')}
            onDelete={() => setDeleteEnv('SANDBOX')}
            onOnboard={() => setOnboardEnv('SANDBOX')}
            onRenew={() => startRenew('SANDBOX')}
            testing={testingEnv === 'SANDBOX'}
            busy={busy}
            canManage={canManage}
            canDelete={canDelete}
          />
          <EnvCard
            title="Production Environment"
            view={snapshot.production}
            isActive={active === 'PRODUCTION'}
            showStartOnboarding={!snapshot.production.connected}
            onTest={() => testConnection('PRODUCTION')}
            onResume={() => resumeOnboarding('PRODUCTION')}
            onDelete={() => setDeleteEnv('PRODUCTION')}
            onOnboard={() => setOnboardEnv('PRODUCTION')}
            onRenew={() => startRenew('PRODUCTION')}
            testing={testingEnv === 'PRODUCTION'}
            busy={busy}
            canManage={canManage}
            canDelete={canDelete}
          />
        </div>
      )}

      {onboardEnv && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-4 space-y-3">
          <h3 className="text-sm font-semibold text-slate-900">
            {onboardEnv === 'PRODUCTION' ? 'Start Production Onboarding' : 'Re-onboard Simulation'}
          </h3>
          <Input label="OTP from Fatoora Portal" value={otp} onChange={(e) => setOtp(e.target.value)} placeholder="e.g. 213710" />
          <div className="flex gap-2">
            <Button onClick={runOnboard} loading={busy}>Continue</Button>
            <Button variant="outline" onClick={() => { setOnboardEnv(null); setOtp('') }}>Cancel</Button>
          </div>
        </div>
      )}

      {deleteEnv && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 space-y-3">
          <h3 className="text-sm font-semibold text-red-800">Delete Local Credentials</h3>
          <p className="text-xs text-red-700">
            This removes locally stored keys and certificates for {deleteEnv === 'SANDBOX' ? 'Simulation' : 'Production'} only.
            It does not call ZATCA, does not modify invoices, and does not delete audit history.
          </p>
          <Input label='Type DELETE to confirm' value={deleteConfirm} onChange={(e) => setDeleteConfirm(e.target.value)} />
          <div className="flex gap-2">
            <Button onClick={confirmDelete} loading={busy} className="bg-red-600 hover:bg-red-700">Delete Local Credentials</Button>
            <Button variant="outline" onClick={() => { setDeleteEnv(null); setDeleteConfirm('') }}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  )
}
