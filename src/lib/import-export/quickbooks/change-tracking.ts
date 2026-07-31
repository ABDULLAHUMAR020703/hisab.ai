import 'server-only'
import { Provider } from '@/integrations/accounting/contracts/types'
import { createAccountingIntegrationRuntime } from '@/integrations/accounting/services/container'
import { createAdminClient } from '@/lib/supabase/admin'
import { applyQuickBooksDeletion, archiveQuickBooksRecord, findArchivedRecord, recordQuickBooksWarning } from './migration-store'

type Row = Record<string, unknown>

/** Entities supported by QBO CDC. TaxAgency, TaxCode, TaxRate and TimeActivity require periodic queries. */
export const QUICKBOOKS_CDC_ENTITIES = [
  'Account','Attachable','Bill','BillPayment','Budget','Class','CompanyCurrency','CreditMemo','Customer','Department',
  'Deposit','Employee','Estimate','ExchangeRate','InventoryAdjustment','Invoice','Item','JournalEntry','Payment',
  'Preferences','Purchase','PurchaseOrder','SalesReceipt','Term','Transfer','Vendor','VendorCredit',
]

function row(value: unknown): Row { return value && typeof value === 'object' ? value as Row : {} }

export interface QuickBooksCdcSummary { changedSince: string; fetchedAt: string; changed: number; deleted: number; conflicts: number }

export async function runQuickBooksCdc(companyId: string): Promise<QuickBooksCdcSummary> {
  const runtime = createAccountingIntegrationRuntime()
  const provider = runtime.providers.get(Provider.QUICKBOOKS)
  if (!provider.getChangeData) throw new Error('The QuickBooks provider does not support CDC.')
  const db = createAdminClient()
  return runtime.connections.executeForProvider(companyId, Provider.QUICKBOOKS, async context => {
    const stored = await db.from('quickbooks_migration_checkpoints').select('*').eq('company_id',companyId).eq('realm_id',context.realmId).eq('resource_key','__cdc__').maybeSingle()
    if (stored.error) throw stored.error
    const now = new Date()
    const since = stored.data?.last_source_updated_at ? new Date(stored.data.last_source_updated_at) : new Date(now.getTime() - 24 * 60 * 60 * 1000)
    const result = await provider.getChangeData!(context, QUICKBOOKS_CDC_ENTITIES, since)
    const summary: QuickBooksCdcSummary = { changedSince:result.changedSince, fetchedAt:result.fetchedAt, changed:0, deleted:0, conflicts:0 }
    for (const [entityType, values] of Object.entries(result.entities)) {
      for (const value of values) {
        const source = row(value); const sourceId = String(source.Id ?? '')
        if (!sourceId) continue
        const previous = await findArchivedRecord(companyId, context.realmId, entityType, sourceId)
        const nextToken = source.SyncToken === undefined ? null : String(source.SyncToken)
        if (previous?.local_id && previous.sync_token && nextToken && previous.sync_token !== nextToken) {
          summary.conflicts++
          await recordQuickBooksWarning({ companyId, realmId:context.realmId, resourceKey:'__cdc__', sourceId, code:'SOURCE_CHANGED_AFTER_IMPORT', message:`QuickBooks ${entityType} ${sourceId} changed after import and requires synchronization.`, details:{ previousSyncToken:previous.sync_token, nextSyncToken:nextToken } })
        }
        if (String(source.status ?? '').toLowerCase() === 'deleted') {
          summary.deleted++
          await applyQuickBooksDeletion(companyId,context.realmId,entityType,sourceId)
        }
        await archiveQuickBooksRecord({ companyId, realmId:context.realmId, entityType, row:{ ...source, _quickbooksRaw:source } })
        summary.changed++
      }
    }
    const checkpoint = await db.from('quickbooks_migration_checkpoints').upsert({ company_id:companyId, realm_id:context.realmId, resource_key:'__cdc__', extraction_mode:'cdc', last_source_updated_at:result.fetchedAt, next_start_position:1, status:'completed', extracted_count:summary.changed, warning_count:summary.conflicts, metadata:summary, updated_at:new Date().toISOString() }, { onConflict:'company_id,realm_id,resource_key' })
    if (checkpoint.error) throw checkpoint.error
    return summary
  })
}

export async function markWebhookEventsProcessed(realmId: string, eventIds: string[]) {
  if (!eventIds.length) return
  const result = await createAdminClient().from('quickbooks_webhook_events').update({ status:'processed', processed_at:new Date().toISOString() }).eq('realm_id',realmId).in('event_id',eventIds)
  if (result.error) throw result.error
}
