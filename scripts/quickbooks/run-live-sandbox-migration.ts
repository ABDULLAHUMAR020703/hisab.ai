import { loadEnvConfig } from '@next/env'

loadEnvConfig(process.cwd())

interface ModuleResult {
  key: string
  sourceCount: number
  validCount: number
  validationFailures: number
  imported: number
  updated: number
  skipped: number
  failed: number
  durationMs: number
  heapStartBytes: number
  heapFinishBytes: number
  errors: Array<{ rowNumber:number; quickBooksId:string|null; errorCode:string; message:string; details?:unknown }>
}

const moduleArgument=process.argv.find(argument=>argument.startsWith('--modules='))?.slice('--modules='.length)
const moduleFilter=moduleArgument?new Set(moduleArgument.split(',').map(value=>value.trim()).filter(Boolean)):null
const smoke=process.argv.includes('--smoke')

async function runPass(companyId:string,userId:string,pass:number):Promise<ModuleResult[]> {
  const [{ getImportSource,fetchSourceResource },{ orderQuickBooksMigrationResources },{ getModuleDefinition },{ coerceMappedRows },{ validateMappedRows },{ detectDuplicates },{ processImport }] = await Promise.all([
    import('../../src/lib/import-export/sources/source-registry'),
    import('../../src/lib/import-export/quickbooks/dependency-order'),
    import('../../src/lib/import-export/registry/module-registry'),
    import('../../src/lib/import-export/validation/validation-engine'),
    import('../../src/lib/import-export/validation/validation-engine'),
    import('../../src/lib/import-export/duplicate/duplicate-detector'),
    import('../../src/lib/import-export/import/import-processor'),
  ])
  const source=getImportSource('quickbooks')
  const results:ModuleResult[]=[]
  for(const resource of orderQuickBooksMigrationResources(source.resources).filter(resource=>!moduleFilter||moduleFilter.has(resource.key))){
    const startedAt=performance.now(),heapStartBytes=process.memoryUsage().heapUsed
    try{
      const normalized=await fetchSourceResource(companyId,'quickbooks',resource.key)
      const definition=getModuleDefinition(resource.moduleKey)
      const mapped=normalized.rows.map((row,index)=>({rowNumber:index+2,source:row,mapped:row}))
      const coerced=coerceMappedRows(mapped,definition.fields)
      const validation=validateMappedRows(coerced,definition.fields)
      const validRows=coerced.filter(row=>validation.validRowNumbers.includes(row.rowNumber))
      const duplicateMatches=await detectDuplicates(definition,validRows,{companyId,userId})
      const imported=await processImport({module:definition,rows:coerced,validation,duplicateStrategy:'update',duplicateMatches,ctx:{companyId,userId},batchSize:100})
      const validationErrors=validation.issues.filter(issue=>issue.severity==='error').map(issue=>{const row=mapped.find(item=>item.rowNumber===issue.rowNumber);return {rowNumber:issue.rowNumber,quickBooksId:row?String(row.mapped._quickbooksId??row.mapped.sourceId??'')||null:null,errorCode:issue.code,message:`validation: ${issue.message}`,details:{stage:'validation',fieldKey:issue.fieldKey}}})
      results.push({key:resource.key,sourceCount:normalized.rows.length,validCount:validation.validRowNumbers.length,validationFailures:validation.errorCount,imported:imported.importedCount,updated:imported.updatedCount,skipped:imported.skippedCount,failed:imported.failedCount+validation.invalidRowNumbers.length,durationMs:Math.round(performance.now()-startedAt),heapStartBytes,heapFinishBytes:process.memoryUsage().heapUsed,errors:[...validationErrors,...imported.errors.map(error=>({rowNumber:error.rowNumber,quickBooksId:error.rawRow?String(error.rawRow._quickbooksId??error.rawRow.sourceId??'')||null:null,errorCode:error.errorCode,message:error.message,details:error.details}))]})
    }catch(error){
      results.push({key:resource.key,sourceCount:0,validCount:0,validationFailures:0,imported:0,updated:0,skipped:0,failed:1,durationMs:Math.round(performance.now()-startedAt),heapStartBytes,heapFinishBytes:process.memoryUsage().heapUsed,errors:[{rowNumber:0,quickBooksId:null,errorCode:String((error as {code?:unknown}).code??'MODULE_FATAL'),message:error instanceof Error?error.message:String(error)}]})
    }
    console.log(JSON.stringify({event:'module_complete',pass,...results.at(-1)}))
  }
  return results
}

async function main(){
  const [{createAdminClient},{buildQuickBooksMigrationReport},{withCompanyContext},{isQuickBooksCertificationEnabled}]=await Promise.all([
    import('../../src/lib/supabase/admin'),
    import('../../src/lib/import-export/quickbooks/migration-report-service'),
    import('../../src/lib/tenant'),
    import('../../src/lib/quickbooks-certification/feature'),
  ])
  const db=createAdminClient()
  const provider=await db.from('accounting_integration_providers').select('id').eq('slug','quickbooks').single()
  if(provider.error)throw provider.error
  const connection=await db.from('accounting_integration_connections').select('tenant_id,connected_by,realm_id,base_currency').eq('provider_id',provider.data.id).eq('status','CONNECTED').order('updated_at',{ascending:false}).limit(1).single()
  if(connection.error)throw connection.error
  if(!connection.data.connected_by)throw new Error('The connected QuickBooks Sandbox has no connected_by user for migration auditing.')
  const companyId=String(connection.data.tenant_id),userId=String(connection.data.connected_by)
  const startedAt=performance.now()
  await withCompanyContext(companyId,async()=>{
    const first=await runPass(companyId,userId,1)
    if(smoke){const result={event:'migration_smoke_complete',durationMs:Math.round(performance.now()-startedAt),first};const {writeFile}=await import('node:fs/promises');await writeFile('test-data/quickbooks-sandbox-smoke-report.json',JSON.stringify(result,null,2),'utf8');console.log(JSON.stringify(result));return}
    const second=await runPass(companyId,userId,2)
    const report=await buildQuickBooksMigrationReport(companyId)
    let certification: { id:string; status:string; summary:unknown } | undefined
    if(isQuickBooksCertificationEnabled()){
      const {runQuickBooksCertification}=await import('../../src/lib/quickbooks-certification/service')
      const today=new Date().toISOString().slice(0,10)
      const completed=await runQuickBooksCertification(companyId,userId,{startDate:'1900-01-01',endDate:today,asOfDate:today,homeCurrency:String(connection.data.base_currency??'USD'),exact:true,multiCurrency:true})
      certification={id:completed.id,status:completed.status,summary:completed.summary}
    }
    const result={event:'migration_complete',realmId:connection.data.realm_id,durationMs:Math.round(performance.now()-startedAt),first,second,report,...(certification?{certification}:{})}
    const {writeFile}=await import('node:fs/promises')
    await writeFile('test-data/quickbooks-sandbox-migration-report.json',JSON.stringify(result,null,2),'utf8')
    console.log(JSON.stringify(result))
  })
}

main().catch(error=>{
  const record=error !== null && typeof error==='object' ? error as Record<string,unknown> : {}
  const cause=record.cause !== null && typeof record.cause==='object' ? record.cause as Record<string,unknown> : {}
  console.error(JSON.stringify({event:'migration_failed',name:error instanceof Error?error.name:'Error',message:error instanceof Error?error.message:String(record.message??error),code:String(record.code??''),details:String(record.details??''),hint:String(record.hint??''),causeCode:String(cause.code??''),causeMessage:String(cause.message??'')}))
  process.exitCode=1
})
