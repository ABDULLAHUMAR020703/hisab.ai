import 'server-only'
import { createHash } from 'node:crypto'
import { Provider } from '@/integrations/accounting/contracts/types'
import { createAccountingIntegrationRuntime } from '@/integrations/accounting/services/container'
import { createAdminClient } from '@/lib/supabase/admin'
import { getImportSource } from '@/lib/import-export/sources/source-registry'
import { getModuleDefinition } from '@/lib/import-export/registry/module-registry'
import type { ImportContext } from '@/lib/import-export/types'
import { QUICKBOOKS_ENTITY_BY_RESOURCE } from '@/lib/import-export/sources/quickbooks.adapter'
import { runQuickBooksCdc } from '@/lib/import-export/quickbooks/change-tracking'

export type SyncMode = 'import_only' | 'two_way'
export type ConflictStrategy = 'source_wins' | 'hisab_wins' | 'manual'
export interface SyncSettings { mode: SyncMode; conflictStrategy: ConflictStrategy; scheduleEnabled: boolean; scheduleCron: string | null; modules: string[]; lastRunAt: string | null; nextRunAt: string | null }
export interface SyncResult { runId: string; status: string; changesDetected: number; importedCount: number; updatedCount: number; conflictCount: number; errorCount: number; changes: Array<{ moduleKey: string; sourceId: string; status: string }> }

const DEFAULT_MODULES = ['accounts', 'customers', 'vendors', 'items', 'tax-codes', 'payment-terms', 'invoices', 'bills', 'payments', 'expenses', 'journal-entries']
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value, Object.keys(value as object).sort())).digest('hex')

export async function getQuickBooksSyncSettings(companyId: string): Promise<SyncSettings> {
  const { data } = await createAdminClient().from('accounting_sync_settings').select('*').eq('company_id', companyId).eq('provider', 'quickbooks').maybeSingle()
  return { mode: (data?.mode ?? 'import_only') as SyncMode, conflictStrategy: (data?.conflict_strategy ?? 'source_wins') as ConflictStrategy, scheduleEnabled: Boolean(data?.schedule_enabled), scheduleCron: data?.schedule_cron ?? null, modules: Array.isArray(data?.modules) ? data.modules : DEFAULT_MODULES, lastRunAt: data?.last_run_at ?? null, nextRunAt: data?.next_run_at ?? null }
}

export async function saveQuickBooksSyncSettings(companyId: string, input: Partial<SyncSettings>): Promise<SyncSettings> {
  const current = await getQuickBooksSyncSettings(companyId)
  const next = { ...current, ...input }
  const { error } = await createAdminClient().from('accounting_sync_settings').upsert({ company_id: companyId, provider: 'quickbooks', mode: next.mode, conflict_strategy: next.conflictStrategy, schedule_enabled: next.scheduleEnabled, schedule_cron: next.scheduleCron, modules: next.modules, updated_at: new Date().toISOString() }, { onConflict: 'company_id,provider' })
  if (error) throw error
  return next
}

export async function syncQuickBooks(companyId: string, userId: string, options: { mode?: SyncMode; conflictStrategy?: ConflictStrategy; modules?: string[] } = {}): Promise<SyncResult> {
  const settings = await getQuickBooksSyncSettings(companyId)
  const mode = options.mode ?? settings.mode
  const conflictStrategy = options.conflictStrategy ?? settings.conflictStrategy
  const moduleKeys = options.modules?.length ? options.modules : settings.modules
  const db = createAdminClient()
  const { data: run, error: runError } = await db.from('accounting_sync_runs').insert({ company_id: companyId, provider: 'quickbooks', mode, status: 'running' }).select('id').single()
  if (runError) throw runError
  const result: SyncResult = { runId: run.id, status: 'completed', changesDetected: 0, importedCount: 0, updatedCount: 0, conflictCount: 0, errorCount: 0, changes: [] }
  try {
    const cdc = await runQuickBooksCdc(companyId)
    const connection = await db.from('accounting_integration_connections').select('realm_id').eq('tenant_id',companyId).eq('status','CONNECTED').maybeSingle()
    const realmId = connection.data?.realm_id as string | undefined
    const pendingEvents = realmId ? await db.from('quickbooks_webhook_events').select('id,event_id,entity_type').eq('realm_id',realmId).in('status',['pending','failed']).order('event_time',{ascending:true}).limit(1000) : { data:[] as Array<{id:string;event_id:string;entity_type:string}>, error:null }
    if (pendingEvents.error) throw pendingEvents.error
    const changedEntities = new Set((pendingEvents.data ?? []).map(event => event.entity_type))
    const runtime = createAccountingIntegrationRuntime(); const provider = runtime.providers.get(Provider.QUICKBOOKS); const source = getImportSource('quickbooks')
    await runtime.connections.executeForProvider(companyId, Provider.QUICKBOOKS, async (context) => {
      for (const resourceKey of moduleKeys) {
        const resource = source.resources.find((item) => item.key === resourceKey); if (!resource) continue
        const entity = QUICKBOOKS_ENTITY_BY_RESOURCE[resourceKey]
        if (changedEntities.size && entity && !changedEntities.has(entity)) continue
        const live = await source.fetchResource(provider, context, resourceKey); const definition = getModuleDefinition(resource.moduleKey)
        const previousBySource=new Map<string,Record<string,unknown>>()
        for(let from=0;;from+=1000){const page=await db.from('accounting_sync_changes').select('*').eq('company_id',companyId).eq('provider','quickbooks').eq('module_key',resource.moduleKey).range(from,from+999);if(page.error)throw page.error;for(const row of page.data??[])previousBySource.set(String(row.source_id),row);if((page.data?.length??0)<1000)break}
        for (const sourceRow of live.rows) {
          const sourceId = String(sourceRow._quickbooksId || sourceRow.sourceId || sourceRow.transactionNo || sourceRow.name || '')
          if (!sourceId) continue
          const sourceHash = hash(sourceRow)
          const previous=previousBySource.get(sourceId)
          if (previous?.source_hash === sourceHash) continue
          result.changesDetected++
          const parsed = definition.parseImportRow ? definition.parseImportRow(sourceRow) : sourceRow
          const duplicate = await definition.findDuplicate(parsed, { companyId, userId } as ImportContext)
          let status = 'detected'
          if (duplicate && conflictStrategy === 'manual') { result.conflictCount++; status = 'conflict' }
          else if (duplicate && (mode === 'import_only' || conflictStrategy === 'source_wins')) { await definition.updateRecord(duplicate.id, parsed, { companyId, userId }); result.updatedCount++; status = 'updated' }
          else if (!duplicate) { await definition.createRecord(parsed, { companyId, userId }); result.importedCount++; status = 'imported' }
          else { status = 'ignored' }
          await db.from('accounting_sync_changes').upsert({ company_id: companyId, provider: 'quickbooks', module_key: resource.moduleKey, source_id: sourceId, source_hash: sourceHash, source_record: sourceRow, status, run_id: run.id, resolved_at: status === 'conflict' ? null : new Date().toISOString(), resolution: conflictStrategy }, { onConflict: 'company_id,provider,module_key,source_id' })
          result.changes.push({ moduleKey: resource.moduleKey, sourceId, status })
        }
      }
    })
    if (pendingEvents.data?.length) {
      const processed = await db.from('quickbooks_webhook_events').update({ status:'processed', processed_at:new Date().toISOString() }).in('id',pendingEvents.data.map(event => event.id))
      if (processed.error) throw processed.error
    }
    await db.from('accounting_sync_runs').update({ status: 'completed', changes_detected: result.changesDetected, imported_count: result.importedCount, updated_count: result.updatedCount, conflict_count: result.conflictCount, error_count: result.errorCount, completed_at: new Date().toISOString(), metadata: { cdc, changes: result.changes.slice(0, 500) } }).eq('id', run.id)
    await saveQuickBooksSyncSettings(companyId, { lastRunAt: new Date().toISOString() })
  } catch (error) {
    result.status = 'failed'; result.errorCount++
    await db.from('accounting_sync_runs').update({ status: 'failed', error: error instanceof Error ? error.message : 'Synchronization failed', completed_at: new Date().toISOString() }).eq('id', run.id)
  }
  return result
}
