import 'server-only'
import { Provider } from '@/integrations/accounting/contracts/types'
import { createAccountingIntegrationRuntime } from '@/integrations/accounting/services/container'
import { QuickBooksImportAdapter } from './quickbooks.adapter'
import type { ImportSourceAdapter, NormalizedImportResource } from './types'
import { createAdminClient } from '@/lib/supabase/admin'

async function fetchWithCheckpoint(tenantId: string, source: ImportSourceAdapter, provider: Parameters<ImportSourceAdapter['fetchResource']>[0], context: Parameters<ImportSourceAdapter['fetchResource']>[1], resourceKey: string) {
  if (source.key !== 'quickbooks') return source.fetchResource(provider, context, resourceKey)
  const db = createAdminClient()
  const existing = await db.from('quickbooks_migration_checkpoints').select('*').eq('company_id',tenantId).eq('realm_id',context.realmId).eq('resource_key',resourceKey).maybeSingle()
  if (existing.error) throw existing.error
  const checkpoint = existing.data
  const resumable=['running','failed'].includes(String(checkpoint?.status))
  if(!resumable){const cleared=await db.from('quickbooks_extraction_staging').delete().eq('company_id',tenantId).eq('realm_id',context.realmId).eq('resource_key',resourceKey);if(cleared.error)throw cleared.error}
  const write = async (progress: { startPosition:number; partitionStart?:string; partitionEnd?:string; fetched:number }) => {
    const result = await db.from('quickbooks_migration_checkpoints').upsert({
      company_id:tenantId, realm_id:context.realmId, resource_key:resourceKey, extraction_mode:progress.partitionStart ? 'partitioned' : 'full',
      partition_start:progress.partitionStart ?? null, partition_end:progress.partitionEnd ?? null,
      next_start_position:progress.startPosition, status:'running', extracted_count:progress.fetched,
      last_error:null, updated_at:new Date().toISOString(),
    }, { onConflict:'company_id,realm_id,resource_key' })
    if (result.error) throw result.error
  }
  const stage=async(rows:Record<string,string>[])=>{
    for(let index=0;index<rows.length;index+=500){const values=rows.slice(index,index+500).map((payload,rowIndex)=>({company_id:tenantId,realm_id:context.realmId,resource_key:resourceKey,source_id:String(payload._quickbooksId||payload.sourceId||`${Date.now()}-${index+rowIndex}`),payload}));const saved=await db.from('quickbooks_extraction_staging').upsert(values,{onConflict:'company_id,realm_id,resource_key,source_id'});if(saved.error)throw saved.error}
  }
  try {
    const result = await source.fetchResource(provider, context, resourceKey, {
      companyId:tenantId,
      resumeStartPosition:resumable ? Number(checkpoint.next_start_position ?? 1) : 1,
      partitionStart:resumable ? checkpoint.partition_start ?? undefined : undefined,
      // partition_end is the current partition boundary, not the requested
      // historical horizon. Let the provider continue through its normal
      // horizon after resuming this partition.
      partitionEnd:undefined,
      onCheckpoint:write,
      onBatch:stage,
    })
    const staged:Record<string,string>[]=[];for(let from=0;;from+=1000){const page=await db.from('quickbooks_extraction_staging').select('payload').eq('company_id',tenantId).eq('realm_id',context.realmId).eq('resource_key',resourceKey).order('source_id').range(from,from+999);if(page.error)throw page.error;staged.push(...(page.data??[]).map(item=>item.payload as Record<string,string>));if((page.data?.length??0)<1000)break}
    const rows=staged.length?staged:result.rows
    const completed = await db.from('quickbooks_migration_checkpoints').upsert({ company_id:tenantId, realm_id:context.realmId, resource_key:resourceKey, extraction_mode:checkpoint?.extraction_mode ?? 'full', partition_start:null, partition_end:null, next_start_position:1, status:'completed', extracted_count:rows.length, last_error:null, updated_at:new Date().toISOString() }, { onConflict:'company_id,realm_id,resource_key' })
    if (completed.error) throw completed.error
    const cleared=await db.from('quickbooks_extraction_staging').delete().eq('company_id',tenantId).eq('realm_id',context.realmId).eq('resource_key',resourceKey);if(cleared.error)throw cleared.error
    return {...result,rows}
  } catch (error) {
    await db.from('quickbooks_migration_checkpoints').upsert({ company_id:tenantId, realm_id:context.realmId, resource_key:resourceKey, extraction_mode:checkpoint?.extraction_mode ?? 'full', status:'failed', last_error:error instanceof Error ? error.message : String(error), updated_at:new Date().toISOString() }, { onConflict:'company_id,realm_id,resource_key' })
    throw error
  }
}

const adapters = new Map<string, ImportSourceAdapter>([
  ['quickbooks', new QuickBooksImportAdapter()],
])

export function listImportSources() {
  return [...adapters.values()].map(({ key, label, resources }) => ({ key, label, resources }))
}

export function getImportSource(key: string): ImportSourceAdapter {
  const source = adapters.get(key)
  if (!source) throw new Error(`Unknown import source: ${key}`)
  return source
}

export async function fetchSourceResource(
  tenantId: string,
  sourceKey: string,
  resourceKey: string,
): Promise<NormalizedImportResource> {
  const source = getImportSource(sourceKey)
  const runtime = createAccountingIntegrationRuntime()
  const providerSlug = sourceKey as Provider
  const provider = runtime.providers.get(providerSlug)
  return runtime.connections.executeForProvider(tenantId, providerSlug, (context) => (
    fetchWithCheckpoint(tenantId, source, provider, context, resourceKey)
  ))
}

export async function fetchSourceResources(
  tenantId: string,
  sourceKey: string,
  resourceKeys: string[],
): Promise<NormalizedImportResource[]> {
  const source = getImportSource(sourceKey)
  const runtime = createAccountingIntegrationRuntime()
  const providerSlug = sourceKey as Provider
  const provider = runtime.providers.get(providerSlug)
  return runtime.connections.executeForProvider(tenantId, providerSlug, async (context) => {
    const results: NormalizedImportResource[] = []
    for (const resourceKey of resourceKeys) {
      results.push(await fetchWithCheckpoint(tenantId, source, provider, context, resourceKey))
    }
    return results
  })
}
