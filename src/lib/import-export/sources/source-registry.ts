import 'server-only'
import { Provider } from '@/integrations/accounting/contracts/types'
import { createAccountingIntegrationRuntime } from '@/integrations/accounting/services/container'
import { QuickBooksImportAdapter } from './quickbooks.adapter'
import type { ImportSourceAdapter, NormalizedImportResource, SourcePreviewBatch } from './types'
import { createAdminClient } from '@/lib/supabase/admin'
import { PreviewStageError, type PreviewStage, type PreviewStageState } from './preview-service'
import { withExternalRequestDiagnostics } from '@/lib/ops/external-request-diagnostics'
import { MigrationTrace } from '../quickbooks/migration-telemetry'

interface SourceFetchDiagnostics {
  onStage?: (stage: PreviewStage, state: PreviewStageState, module: string) => void
}

async function clearQuickBooksStaging(
  db: ReturnType<typeof createAdminClient>,
  tenantId: string,
  realmId: string,
  resourceKey: string,
): Promise<void> {
  let lastError: unknown
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const cleared = await db.from('quickbooks_extraction_staging')
        .delete()
        .eq('company_id', tenantId)
        .eq('realm_id', realmId)
        .eq('resource_key', resourceKey)
        .abortSignal(AbortSignal.timeout(60_000))
      if (!cleared.error) return
      lastError = cleared.error
    } catch (error) {
      lastError = error
    }
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 250 * (2 ** (attempt - 1))))
  }
  throw lastError instanceof Error ? lastError : new Error(`Unable to clear QuickBooks staging for ${resourceKey}.`, { cause: lastError })
}

async function historicalTransactionExchangeRates(tenantId:string,realmId:string,source:QuickBooksImportAdapter):Promise<NormalizedImportResource>{
  const db=createAdminClient(),records:Array<Record<string,unknown>>=[]
  for(let from=0;;from+=1000){
    const page=await db.from('quickbooks_migration_records').select('currency_code,exchange_rate,source_payload').eq('company_id',tenantId).eq('realm_id',realmId).not('currency_code','is',null).not('exchange_rate','is',null).range(from,from+999)
    if(page.error)throw page.error
    records.push(...(page.data??[]))
    if((page.data?.length??0)<1000)break
  }
  const company=await db.from('companies').select('currency').eq('id',tenantId).single()
  if(company.error)throw company.error
  const home=String(company.data.currency??'').toUpperCase(),unique=new Map<string,Record<string,unknown>>()
  for(const record of records){
    const payload=record.source_payload&&typeof record.source_payload==='object'?record.source_payload as Record<string,unknown>:{}
    const currency=String(record.currency_code??'').toUpperCase(),date=String(payload.TxnDate??payload.TxnDateTime??'').slice(0,10),rate=Number(record.exchange_rate)
    if(!currency||currency===home||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(rate)||rate<=0)continue
    unique.set(`${currency}:${home}:${date}`,{SourceCurrencyCode:currency,TargetCurrencyCode:home,AsOfDate:date,Rate:rate})
  }
  const resource=source.resources.find(item=>item.key==='exchange-rates')!
  return {...resource,rows:source.normalizeRecords('exchange-rates',[...unique.values()],realmId),totalCount:unique.size,countAccuracy:'exact'}
}

export interface SourcePreviewSession {
  source: ImportSourceAdapter
  fetchResource: (resourceKey: string) => Promise<NormalizedImportResource>
}

async function runStage<T>(stage: PreviewStage, module: string, diagnostics: SourceFetchDiagnostics | undefined, operation: () => Promise<T> | T): Promise<T> {
  diagnostics?.onStage?.(stage, 'started', module)
  try {
    const result = await operation()
    diagnostics?.onStage?.(stage, 'completed', module)
    return result
  } catch (error) {
    diagnostics?.onStage?.(stage, 'failed', module)
    if (error instanceof PreviewStageError) throw error
    const record = error !== null && typeof error === 'object' ? error as Record<string, unknown> : {}
    const message = error instanceof Error ? error.message : typeof record.message === 'string' ? record.message : `Preview failed during ${stage}.`
    const code = typeof record.code === 'string' ? record.code : `${stage.toUpperCase()}_FAILED`
    throw new PreviewStageError(stage, code, message, { cause: error })
  }
}

async function fetchWithCheckpoint(tenantId: string, source: ImportSourceAdapter, provider: Parameters<ImportSourceAdapter['fetchResource']>[0], context: Parameters<ImportSourceAdapter['fetchResource']>[1], resourceKey: string, diagnostics?: SourceFetchDiagnostics) {
  if (source.key !== 'quickbooks') return source.fetchResource(provider, context, resourceKey)
  const trace = new MigrationTrace(resourceKey)
  const db = createAdminClient()
  if(resourceKey==='exchange-rates'&&source instanceof QuickBooksImportAdapter){
    try{
      const result=await withExternalRequestDiagnostics({correlationId:trace.correlationId,module:resourceKey,onRequest:trace.request},()=>trace.measure('extraction',()=>historicalTransactionExchangeRates(tenantId,context.realmId,source)))
      const completed=await db.from('quickbooks_migration_checkpoints').upsert({company_id:tenantId,realm_id:context.realmId,resource_key:resourceKey,extraction_mode:'full',partition_start:null,partition_end:null,next_start_position:1,status:'completed',extracted_count:result.rows.length,last_error:null,updated_at:new Date().toISOString()},{onConflict:'company_id,realm_id,resource_key'});if(completed.error)throw completed.error
      await trace.measure('staging_cleanup',()=>clearQuickBooksStaging(db,tenantId,context.realmId,resourceKey))
      trace.finish({fetched:result.rows.length})
      return result
    }catch(error){trace.finish();throw error}
  }
  const existing = await trace.measure('module_scheduling', () => runStage('checkpoint_lookup', resourceKey, diagnostics, async () => {
    const result = await db.from('quickbooks_migration_checkpoints').select('*').eq('company_id',tenantId).eq('realm_id',context.realmId).eq('resource_key',resourceKey).maybeSingle()
    if (result.error) throw result.error
    return result
  }))
  const checkpoint = existing.data
  const resumable=['running','failed'].includes(String(checkpoint?.status))
  if(!resumable)await trace.measure('staging_cleanup',()=>clearQuickBooksStaging(db,tenantId,context.realmId,resourceKey))
  const write = async (progress: { startPosition:number; partitionStart?:string; partitionEnd?:string; fetched:number }) => {
    const result = await db.from('quickbooks_migration_checkpoints').upsert({
      company_id:tenantId, realm_id:context.realmId, resource_key:resourceKey, extraction_mode:progress.partitionStart ? 'partitioned' : 'full',
      partition_start:progress.partitionStart ?? null, partition_end:progress.partitionEnd ?? null,
      next_start_position:progress.startPosition, status:'running', extracted_count:progress.fetched,
      last_error:null, updated_at:new Date().toISOString(),
    }, { onConflict:'company_id,realm_id,resource_key' })
    if (result.error) throw result.error
  }
  const stage=async(rows:Record<string,string>[],progress: { startPosition:number; partitionStart?:string; partitionEnd?:string; fetched:number })=>{
    const startedAt=performance.now()
    try {
      for(let index=0;index<rows.length;index+=500){const values=rows.slice(index,index+500).map((payload,rowIndex)=>({company_id:tenantId,realm_id:context.realmId,resource_key:resourceKey,source_id:String(payload._quickbooksId||payload.sourceId||`${Date.now()}-${index+rowIndex}`),payload}));const saved=await db.from('quickbooks_extraction_staging').upsert(values,{onConflict:'company_id,realm_id,resource_key,source_id'});if(saved.error)throw saved.error}
      await write(progress)
      trace.accumulate('pagination',performance.now()-startedAt)
      trace.page(rows.length,progress.fetched)
    } catch(error) {
      trace.accumulate('pagination',performance.now()-startedAt,true)
      throw error
    }
  }
  try {
    const result = await withExternalRequestDiagnostics({ correlationId:trace.correlationId, module:resourceKey, onRequest:trace.request }, () => trace.measure('extraction', () => source.fetchResource(provider, context, resourceKey, {
      companyId:tenantId,
      resumeStartPosition:resumable ? Number(checkpoint.next_start_position ?? 1) : 1,
      partitionStart:resumable ? checkpoint.partition_start ?? undefined : undefined,
      // partition_end is the current partition boundary, not the requested
      // historical horizon. Let the provider continue through its normal
      // horizon after resuming this partition.
      partitionEnd:undefined,
      signal:AbortSignal.timeout(30*60_000),
      onBatch:stage,
    })))
    const staged:Record<string,string>[]=[];for(let from=0;;from+=1000){const page=await db.from('quickbooks_extraction_staging').select('payload').eq('company_id',tenantId).eq('realm_id',context.realmId).eq('resource_key',resourceKey).order('source_id').range(from,from+999);if(page.error)throw page.error;staged.push(...(page.data??[]).map(item=>item.payload as Record<string,string>));if((page.data?.length??0)<1000)break}
    const rows=staged.length?staged:result.rows
    const completed = await db.from('quickbooks_migration_checkpoints').upsert({ company_id:tenantId, realm_id:context.realmId, resource_key:resourceKey, extraction_mode:checkpoint?.extraction_mode ?? 'full', partition_start:null, partition_end:null, next_start_position:1, status:'completed', extracted_count:rows.length, last_error:null, updated_at:new Date().toISOString() }, { onConflict:'company_id,realm_id,resource_key' })
    if (completed.error) throw completed.error
    await trace.measure('staging_cleanup',()=>clearQuickBooksStaging(db,tenantId,context.realmId,resourceKey))
    trace.finish({fetched:rows.length})
    return {...result,rows}
  } catch (error) {
    await db.from('quickbooks_migration_checkpoints').upsert({ company_id:tenantId, realm_id:context.realmId, resource_key:resourceKey, extraction_mode:checkpoint?.extraction_mode ?? 'full', status:'failed', last_error:error instanceof Error ? error.message : String(error), updated_at:new Date().toISOString() }, { onConflict:'company_id,realm_id,resource_key' })
    trace.finish()
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

/**
 * Resolves the provider and OAuth connection once for the whole preview request.
 * Preview fetches deliberately bypass extraction checkpoints and staging because
 * they only request an exact count and a bounded sample.
 */
export async function withSourcePreviewSession<T>(
  tenantId: string,
  sourceKey: string,
  sampleSize: number,
  diagnostics: SourceFetchDiagnostics | undefined,
  operation: (session: SourcePreviewSession) => Promise<T>,
): Promise<T> {
  const source = await runStage('adapter_initialization', 'all', diagnostics, () => getImportSource(sourceKey))
  const runtime = await runStage('provider_lookup', 'all', diagnostics, () => createAccountingIntegrationRuntime())
  const providerSlug = sourceKey as Provider
  const provider = await runStage('provider_lookup', 'all', diagnostics, () => runtime.providers.get(providerSlug))
  const cache = new Map<string, Promise<SourcePreviewBatch>>()
  diagnostics?.onStage?.('connection_lookup', 'started', 'all')
  let connectionResolved = false
  try {
    return await runtime.connections.executeForProvider(tenantId, providerSlug, async (context) => {
      connectionResolved = true
      diagnostics?.onStage?.('connection_lookup', 'completed', 'all')
      return operation({
        source,
        fetchResource: (resourceKey) => runStage(
          'quickbooks_request',
          resourceKey,
          diagnostics,
          () => source.fetchResource(provider, context, resourceKey, {
            companyId: tenantId,
            preview: { sampleSize, cache },
          }),
        ),
      })
    })
  } catch (error) {
    if (error instanceof PreviewStageError) throw error
    if (!connectionResolved) diagnostics?.onStage?.('connection_lookup', 'failed', 'all')
    const record = error !== null && typeof error === 'object' ? error as Record<string, unknown> : {}
    const message = error instanceof Error ? error.message : typeof record.message === 'string' ? record.message : 'QuickBooks connection lookup failed.'
    const code = typeof record.code === 'string' ? record.code : 'CONNECTION_LOOKUP_FAILED'
    throw new PreviewStageError(connectionResolved ? 'quickbooks_request' : 'connection_lookup', code, message, { cause: error })
  }
}

export async function fetchSourceResource(
  tenantId: string,
  sourceKey: string,
  resourceKey: string,
  diagnostics?: SourceFetchDiagnostics,
): Promise<NormalizedImportResource> {
  const source = await runStage('adapter_initialization', resourceKey, diagnostics, () => getImportSource(sourceKey))
  const runtime = await runStage('provider_lookup', resourceKey, diagnostics, () => createAccountingIntegrationRuntime())
  const providerSlug = sourceKey as Provider
  const provider = await runStage('provider_lookup', resourceKey, diagnostics, () => runtime.providers.get(providerSlug))
  diagnostics?.onStage?.('connection_lookup', 'started', resourceKey)
  let connectionResolved = false
  try {
    return await runtime.connections.executeForProvider(tenantId, providerSlug, (context) => {
      connectionResolved = true
      diagnostics?.onStage?.('connection_lookup', 'completed', resourceKey)
      return fetchWithCheckpoint(tenantId, source, provider, context, resourceKey, diagnostics)
    })
  } catch (error) {
    if (error instanceof PreviewStageError) throw error
    if (!connectionResolved) diagnostics?.onStage?.('connection_lookup', 'failed', resourceKey)
    const record = error !== null && typeof error === 'object' ? error as Record<string, unknown> : {}
    const message = error instanceof Error ? error.message : typeof record.message === 'string' ? record.message : 'QuickBooks connection lookup failed.'
    const code = typeof record.code === 'string' ? record.code : 'CONNECTION_LOOKUP_FAILED'
    throw new PreviewStageError('connection_lookup', code, message, { cause: error })
  }
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
