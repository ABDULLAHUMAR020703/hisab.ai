import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildMigrationReport, type MigrationReport } from '../migration-report'

export async function buildQuickBooksMigrationReport(companyId:string): Promise<MigrationReport> {
  const db = createAdminClient()
  const [records,warnings,checkpoints,materializations,company] = await Promise.all([
    db.from('quickbooks_migration_records').select('entity_type,local_id,is_deleted,created_at,updated_at').eq('company_id',companyId),
    db.from('quickbooks_migration_warnings').select('resource_key,code').eq('company_id',companyId),
    db.from('quickbooks_migration_checkpoints').select('resource_key,status,failure_count,updated_at,created_at').eq('company_id',companyId),
    db.from('quickbooks_materialization_runs').select('entity_type,source_id,local_id,status,last_error').eq('company_id',companyId),
    db.from('companies').select('company_name,currency').eq('id',companyId).single(),
  ])
  for (const result of [records,warnings,checkpoints,materializations,company]) if (result.error) throw result.error
  const types = [...new Set((records.data ?? []).map(record => record.entity_type))].sort()
  const modules = types.map(entityType => {
    const source = (records.data ?? []).filter(record => record.entity_type === entityType)
    const linked = source.filter(record => record.local_id)
    const accountingRuns = (materializations.data ?? []).filter(run => run.entity_type === entityType)
    const incompleteAccounting = accountingRuns.filter(run => run.status !== 'completed')
    const incompleteLocalIds = new Set(incompleteAccounting.map(run => String(run.local_id)))
    const accountingValid = linked.filter(record => !incompleteLocalIds.has(String(record.local_id)))
    const relatedWarnings = (warnings.data ?? []).filter(warning => warning.resource_key.toLowerCase().includes(entityType.toLowerCase()))
    const checkpoint = (checkpoints.data ?? []).find(item => item.resource_key.toLowerCase().includes(entityType.toLowerCase()))
    const first = source.map(record => new Date(record.created_at).getTime()).filter(Number.isFinite)
    const last = source.map(record => new Date(record.updated_at).getTime()).filter(Number.isFinite)
    return { key:entityType, label:entityType, sourceCount:source.length, validCount:accountingValid.length, warningCount:relatedWarnings.length + incompleteAccounting.filter(run => run.status === 'manual_required').length, validationErrors:(source.length - linked.length) + incompleteAccounting.length, importedCount:linked.length, updatedCount:0, skippedCount:source.length - linked.length, failedCount:Number(checkpoint?.failure_count ?? 0), durationMs:first.length && last.length ? Math.max(...last) - Math.min(...first) : 0 }
  })
  const dates = (records.data ?? []).flatMap(record => [new Date(record.created_at).getTime(),new Date(record.updated_at).getTime()]).filter(Number.isFinite)
  return buildMigrationReport({ source:'QuickBooks Online', companyName:company.data?.company_name ?? null, currency:company.data?.currency ?? null, durationMs:dates.length ? Math.max(...dates) - Math.min(...dates) : 0, modules })
}
