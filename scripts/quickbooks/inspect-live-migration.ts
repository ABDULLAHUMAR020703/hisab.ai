import { loadEnvConfig } from '@next/env'

loadEnvConfig(process.cwd())

async function main(){
  const {createAdminClient}=await import('../../src/lib/supabase/admin')
  const db=createAdminClient()
  const provider=await db.from('accounting_integration_providers').select('id').eq('slug','quickbooks').single()
  if(provider.error)throw provider.error
  const connection=await db.from('accounting_integration_connections').select('tenant_id').eq('provider_id',provider.data.id).eq('status','CONNECTED').order('updated_at',{ascending:false}).limit(1).single()
  if(connection.error)throw connection.error
  const companyId=String(connection.data.tenant_id)
  const [checkpoints,jobs,materializations,exchangeRateStaging,exchangeRateFirst,exchangeRateLast]=await Promise.all([
    db.from('quickbooks_migration_checkpoints').select('resource_key,status,extracted_count,next_start_position,partition_start,updated_at,last_error').eq('company_id',companyId).order('updated_at',{ascending:false}).limit(40),
    db.from('import_jobs').select('module_key,status,total_rows,processed_rows,imported_count,updated_count,skipped_count,failed_count,last_heartbeat_at').eq('company_id',companyId).order('updated_at',{ascending:false}).limit(40),
    db.from('quickbooks_materialization_runs').select('module_key,source_id,local_id,status,attempt_count,started_at,updated_at,last_error,validation').eq('company_id',companyId).order('updated_at',{ascending:false}).limit(40),
    db.from('quickbooks_extraction_staging').select('source_id',{count:'exact',head:true}).eq('company_id',companyId).eq('resource_key','exchange-rates'),
    db.from('quickbooks_extraction_staging').select('source_id').eq('company_id',companyId).eq('resource_key','exchange-rates').order('source_id',{ascending:true}).limit(5),
    db.from('quickbooks_extraction_staging').select('source_id').eq('company_id',companyId).eq('resource_key','exchange-rates').order('source_id',{ascending:false}).limit(5),
  ])
  for(const result of [checkpoints,jobs,materializations,exchangeRateStaging,exchangeRateFirst,exchangeRateLast])if(result.error)throw result.error
  console.log(JSON.stringify({latestCheckpoint:checkpoints.data?.[0],activeCheckpoint:checkpoints.data?.find(item=>item.status==='running'),recentJob:jobs.data?.[0],recentMaterialization:materializations.data?.[0],exchangeRateStagingCount:exchangeRateStaging.count,exchangeRateFirst:exchangeRateFirst.data,exchangeRateLast:exchangeRateLast.data},null,2))
}

main().catch(error=>{const record=error !== null&&typeof error==='object'?error as Record<string,unknown>:{};console.error(JSON.stringify({message:String(record.message??error),details:String(record.details??''),code:String(record.code??'')}));process.exitCode=1})
