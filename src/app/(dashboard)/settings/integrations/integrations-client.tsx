'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, Clock3, Download, Link2, RefreshCw, ShieldCheck, Unplug } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ImportWizard } from '@/components/import-export/ImportWizard'
import { useMigrationSession } from '@/components/import-export/MigrationSessionProvider'
import { resolveMigrateEntryAction } from '@/lib/import-export/wizard/migration-navigation'

type Status = 'NOT_CONNECTED' | 'PENDING' | 'CONNECTED' | 'FAILED' | 'DISCONNECTED' | 'TOKEN_EXPIRED'

interface IntegrationItem {
  provider: string
  name: string
  logo: string | null
  isActive: boolean
  connected: boolean
  status: Status
  companyName: string | null
  lastSync: string | null
  realmId: string | null
  companyEmail: string | null
  country: string | null
  baseCurrency: string | null
  timezone: string | null
  legalName: string | null
  connectedAt: string | null
}

interface OAuthFeedback {
  kind: 'connected' | 'error'
  message?: string
}

const STATUS_UI: Record<Status, { label: string; className: string; dot: string }> = {
  NOT_CONNECTED: { label: 'Not Connected', className: 'bg-slate-50 text-slate-600 border-slate-200', dot: 'bg-slate-400' },
  PENDING: { label: 'Pending', className: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500' },
  CONNECTED: { label: 'Connected', className: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
  FAILED: { label: 'Failed', className: 'bg-red-50 text-red-700 border-red-200', dot: 'bg-red-500' },
  DISCONNECTED: { label: 'Disconnected', className: 'bg-slate-50 text-slate-600 border-slate-200', dot: 'bg-slate-400' },
  TOKEN_EXPIRED: { label: 'Token Expired', className: 'bg-orange-50 text-orange-700 border-orange-200', dot: 'bg-orange-500' },
}

async function apiError(response: Response): Promise<string> {
  const body = await response.json().catch(() => null) as { error?: string | { message?: string } } | null
  if (typeof body?.error === 'string') return body.error
  return body?.error?.message ?? 'The integration request could not be completed.'
}

export function IntegrationsClient({ oauthFeedback, certificationEnabled }: { oauthFeedback?: OAuthFeedback; certificationEnabled: boolean }) {
  const { openMigrationCenter, session } = useMigrationSession()
  const [items, setItems] = useState<IntegrationItem[]>([])
  const [loading, setLoading] = useState(true)
  const [busyProvider, setBusyProvider] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showImport, setShowImport] = useState(false)
  const [syncSettings, setSyncSettings] = useState<{ mode: 'import_only' | 'two_way'; conflictStrategy: 'source_wins' | 'hisab_wins' | 'manual'; scheduleEnabled: boolean; scheduleCron: string | null; lastRunAt: string | null } | null>(null)
  const [syncBusy, setSyncBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/integrations', { cache: 'no-store' })
      if (!response.ok) throw new Error(await apiError(response))
      setItems(await response.json() as IntegrationItem[])
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load integrations.')
    } finally {
      setLoading(false)
    }
  }, [])

  /** Migrate never silently no-ops: open the wizard, or resume Migration Center. */
  const openMigrate = useCallback(() => {
    const action = resolveMigrateEntryAction(session)
    if (action.type === 'open-migration-center') {
      openMigrationCenter(action.sessionId)
      return
    }
    setShowImport(true)
  }, [openMigrationCenter, session])

  const handleWizardSuccess = useCallback((sessionId?: string) => {
    if (sessionId) openMigrationCenter(sessionId)
    void load()
  }, [load, openMigrationCenter])

  useEffect(() => {
    const timer = window.setTimeout(() => { void load() }, 0)
    return () => window.clearTimeout(timer)
  }, [load])

  useEffect(() => {
    if (oauthFeedback?.kind !== 'connected') return
    const timer = window.setTimeout(() => openMigrate(), 0)
    return () => window.clearTimeout(timer)
  }, [oauthFeedback, openMigrate])

  async function mutate(provider: string, action: 'connect' | 'disconnect') {
    setBusyProvider(provider)
    setError(null)
    try {
      const response = await fetch(`/api/integrations/${provider}/${action}`, { method: 'POST' })
      if (!response.ok) throw new Error(await apiError(response))
      if (action === 'connect') {
        const body = await response.json() as { authorizationUrl?: string }
        if (!body.authorizationUrl) throw new Error('The provider did not return an authorization URL.')
        const authorizationUrl = new URL(body.authorizationUrl)
        if (authorizationUrl.protocol !== 'https:' || authorizationUrl.hostname !== 'appcenter.intuit.com') {
          throw new Error('The provider returned an invalid authorization URL.')
        }
        window.location.assign(authorizationUrl.toString())
        return
      }
      await load()
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : 'Unable to update the integration.')
    } finally {
      setBusyProvider(null)
    }
  }

  async function loadSyncSettings() {
    const response = await fetch('/api/integrations/quickbooks/sync', { cache: 'no-store' })
    if (response.ok) setSyncSettings(await response.json())
  }
  async function runSync() {
    setSyncBusy(true); setError(null)
    try { const response = await fetch('/api/integrations/quickbooks/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) }); if (!response.ok) throw new Error(await apiError(response)); await loadSyncSettings() } catch (reason) { setError(reason instanceof Error ? reason.message : 'Synchronization failed.') } finally { setSyncBusy(false) }
  }
  async function saveSync(patch: Record<string, unknown>) {
    const response = await fetch('/api/integrations/quickbooks/sync', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) }); if (response.ok) setSyncSettings(await response.json())
  }

  if (loading && items.length === 0) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        {[0, 1, 2, 3].map((item) => <div key={item} className="h-64 animate-pulse rounded-2xl border border-slate-200 bg-white" />)}
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {oauthFeedback?.kind === 'connected' && (
        <div role="status" className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          <CheckCircle2 size={18} className="mt-0.5 shrink-0" />
          <span>QuickBooks Online connected successfully.</span>
        </div>
      )}
      {oauthFeedback?.kind === 'error' && (
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle size={18} className="mt-0.5 shrink-0" />
          <span>{oauthFeedback.message ?? 'QuickBooks authorization could not be completed.'}</span>
        </div>
      )}
      {error && (
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle size={18} className="mt-0.5 shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={() => void load()} className="font-semibold hover:underline">Try again</button>
        </div>
      )}

      <div className="grid gap-5 md:grid-cols-2">
        {items.map((item) => {
          const status = STATUS_UI[item.status]
          const isQuickBooks = item.provider === 'quickbooks'
          const canDisconnect = item.status === 'CONNECTED' || item.status === 'PENDING'
          return (
            <article key={item.provider} className={cn(
              'group relative overflow-hidden rounded-2xl border bg-white p-6 shadow-sm transition-all',
              isQuickBooks ? 'border-slate-200 hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-md' : 'border-slate-200',
            )}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-100 bg-slate-50">
                    {item.logo && <Image src={item.logo} alt={`${item.name} logo`} width={40} height={40} className="h-10 w-10 object-contain" />}
                  </div>
                  <div>
                    <h2 className="font-semibold text-slate-900">{item.name}</h2>
                    <p className="mt-1 text-xs text-slate-400">Accounting platform</p>
                  </div>
                </div>
                {!item.isActive ? (
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Coming Soon</span>
                ) : (
                  <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold', status.className)}>
                    <span className={cn('h-1.5 w-1.5 rounded-full', status.dot)} />{status.label}
                  </span>
                )}
              </div>

              <dl className="mt-6 grid grid-cols-3 gap-3 border-y border-slate-100 py-4">
                {[
                  ['Company Name', item.companyName ?? '—'],
                  ['Connected Since', item.connectedAt ? new Date(item.connectedAt).toLocaleString() : '—'],
                  ['Realm ID', item.realmId ?? '—'],
                ].map(([label, value]) => (
                  <div key={label} className="min-w-0">
                    <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</dt>
                    <dd className="mt-1 truncate text-xs font-medium text-slate-700" title={value}>{value}</dd>
                  </div>
                ))}
              </dl>

              {item.connected && (
                <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl bg-slate-50 p-4 text-xs">
                  {[
                    ['Legal Name', item.legalName ?? '—'],
                    ['Email', item.companyEmail ?? '—'],
                    ['Country', item.country ?? '—'],
                    ['Base Currency', item.baseCurrency ?? '—'],
                    ['Timezone', item.timezone ?? '—'],
                  ].map(([label, value]) => (
                    <div key={label} className="min-w-0">
                      <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</dt>
                      <dd className="mt-0.5 truncate font-medium text-slate-700" title={value}>{value}</dd>
                    </div>
                  ))}
                </dl>
              )}

              <div className="mt-5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  {item.status === 'CONNECTED' ? <CheckCircle2 size={15} className="text-emerald-500" /> : item.status === 'PENDING' ? <Clock3 size={15} className="text-amber-500" /> : <ShieldCheck size={15} className="text-slate-400" />}
                  {item.isActive ? 'Secure tenant-scoped connection' : 'Provider adapter reserved'}
                </div>
                {isQuickBooks && item.isActive && (
                  canDisconnect ? (
                    <div className="flex gap-2">
                      {item.status === 'CONNECTED' && <Link href="/settings/integrations/quickbooks-validation" className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"><ShieldCheck size={14} /> Validate</Link>}
                      {certificationEnabled && item.status === 'CONNECTED' && <Link href="/settings/integrations/quickbooks-certification" className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50">Certify</Link>}
                      {item.status === 'CONNECTED' && <Button onClick={openMigrate}><Download size={14} /> Migrate</Button>}
                      <Button variant="outline" loading={busyProvider === item.provider} onClick={() => void mutate(item.provider, 'disconnect')}>
                        <Unplug size={14} /> Disconnect
                      </Button>
                    </div>
                  ) : (
                    <Button loading={busyProvider === item.provider} onClick={() => void mutate(item.provider, 'connect')}>
                      <Link2 size={14} /> Connect
                    </Button>
                  )
                )}
              </div>
              {isQuickBooks && item.status === 'CONNECTED' && <div className="mt-4 space-y-3 rounded-xl border border-indigo-100 bg-indigo-50/50 p-3"><div className="flex items-center justify-between"><p className="text-xs font-semibold text-indigo-900">Synchronization</p><Button variant="outline" loading={syncBusy} onClick={() => void runSync()}><RefreshCw size={13} /> Sync now</Button></div><div className="grid grid-cols-2 gap-2"><label className="text-[11px] text-slate-600">Mode<select value={syncSettings?.mode ?? 'import_only'} onFocus={() => void loadSyncSettings()} onChange={(event) => void saveSync({ mode: event.target.value })} className="mt-1 block w-full rounded-md border-slate-200 text-xs"><option value="import_only">Import only</option><option value="two_way">Two-way sync</option></select></label><label className="text-[11px] text-slate-600">Conflicts<select value={syncSettings?.conflictStrategy ?? 'source_wins'} onFocus={() => void loadSyncSettings()} onChange={(event) => void saveSync({ conflictStrategy: event.target.value })} className="mt-1 block w-full rounded-md border-slate-200 text-xs"><option value="source_wins">QuickBooks wins</option><option value="hisab_wins">Hisab wins</option><option value="manual">Review manually</option></select></label></div><label className="flex items-center gap-2 text-[11px] text-slate-600"><input type="checkbox" checked={syncSettings?.scheduleEnabled ?? false} onFocus={() => void loadSyncSettings()} onChange={(event) => void saveSync({ scheduleEnabled: event.target.checked, scheduleCron: '@hourly' })} /> Schedule hourly sync {syncSettings?.lastRunAt ? `· Last run ${new Date(syncSettings.lastRunAt).toLocaleString()}` : ''}</label><Link href="/settings/integrations/quickbooks-validation" className="text-[11px] font-medium text-indigo-700 hover:underline">Review changes and conflicts</Link></div>}
            </article>
          )
        })}
      </div>

      <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
        <span>Connection credentials are encrypted and never returned by the API.</span>
        <button onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-1.5 font-semibold text-indigo-600 disabled:opacity-50">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>
      <ImportWizard open={showImport} onClose={() => setShowImport(false)} onSuccess={handleWizardSuccess} initialSource="quickbooks" />
    </div>
  )
}
