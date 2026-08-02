import 'server-only'
import { createHash, randomUUID } from 'node:crypto'
import { Provider } from '@/integrations/accounting/contracts/types'
import { createAccountingIntegrationRuntime } from '@/integrations/accounting/services/container'
import { createAdminClient } from '@/lib/supabase/admin'
import { validateQuickBooksAccountingMaterialization } from '@/lib/quickbooks-validation/accounting'
import { canonicalSnapshot, compareSnapshots, validateCrossReportIntegrity } from './engine'
import { generateHisabSnapshot } from './hisab-reports'
import { buildQuickBooksReportRequest, normalizeQuickBooksReport } from './quickbooks-reports'
import { certifyMultiCurrency } from './multicurrency'
import { certifyPaymentAllocations } from './payment-allocations'
import { certifyDeposits } from './deposits'
import { certifyVendorCredits } from './vendor-credits'
import { certifySalesReceipts } from './sales-receipts'
import { certifyRetainedEarnings } from './retained-earnings'
import { CERTIFICATION_REPORTS, type AccountingCertificationReport, type CertificationParameters, type CertificationReportKey, type CertificationSection, type CertificationSectionKey, type FinancialReportSnapshot } from './types'
import { assertQuickBooksCertificationEnabled } from './feature'

function stable(value:unknown):string{if(Array.isArray(value))return `[${value.map(stable).join(',')}]`;if(value&&typeof value==='object')return `{${Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;return JSON.stringify(value)??'null'}
const hash=(value:unknown)=>createHash('sha256').update(stable(value)).digest('hex')
function unavailable(reportKey:Exclude<CertificationSectionKey,'cross-report'>,message:string):CertificationSection{return {reportKey,label:reportKey.replaceAll('-',' '),status:'UNAVAILABLE',matchedRows:0,comparedRows:0,maximumDifference:0,differences:[],error:message}}

async function parallelMap<T,R>(items:T[],concurrency:number,worker:(item:T)=>Promise<R>):Promise<Array<PromiseSettledResult<R>>>{
  const results:Array<PromiseSettledResult<R>>=new Array(items.length);let cursor=0
  await Promise.all(Array.from({length:Math.min(concurrency,items.length)},async()=>{while(cursor<items.length){const index=cursor++;try{results[index]={status:'fulfilled',value:await worker(items[index])}}catch(reason){results[index]={status:'rejected',reason}}}}))
  return results
}

export function validateCertificationParameters(input:Partial<CertificationParameters>):CertificationParameters{
  const today=new Date().toISOString().slice(0,10);const year=`${new Date().getUTCFullYear()}-01-01`
  const parameters:CertificationParameters={startDate:String(input.startDate??year),endDate:String(input.endDate??today),asOfDate:String(input.asOfDate??input.endDate??today),accountingBasis:input.accountingBasis==='Cash'?'Cash':'Accrual',homeCurrency:String(input.homeCurrency??'SAR').toUpperCase(),multiCurrency:Boolean(input.multiCurrency),exact:Boolean(input.exact),absoluteTolerance:Math.max(0,Number(input.absoluteTolerance??0.01)),relativeTolerance:Math.max(0,Number(input.relativeTolerance??0)),classIds:input.classIds,departmentIds:input.departmentIds,projectIds:input.projectIds,customerIds:input.customerIds,vendorIds:input.vendorIds}
  for(const date of [parameters.startDate,parameters.endDate,parameters.asOfDate])if(Number.isNaN(new Date(`${date}T00:00:00Z`).getTime()))throw new Error('Certification dates must use YYYY-MM-DD.')
  if(parameters.startDate>parameters.endDate)throw new Error('Certification start date cannot be after end date.')
  if(parameters.exact){parameters.absoluteTolerance=0;parameters.relativeTolerance=0}
  return parameters
}

export async function runQuickBooksCertification(companyId:string,userId:string,input:Partial<CertificationParameters>):Promise<AccountingCertificationReport>{
  assertQuickBooksCertificationEnabled()
  const parameters=validateCertificationParameters(input);const db=createAdminClient();const runtime=createAccountingIntegrationRuntime();const provider=runtime.providers.get(Provider.QUICKBOOKS);const runId=randomUUID()
  const connection=await runtime.connections.executeForProvider(companyId,Provider.QUICKBOOKS,async context=>({realmId:context.realmId,context,company:await provider.getCompanyInfo(context)}))
  const quickBooksCurrency=connection.company.baseCurrency?.trim().toUpperCase()
  if(input.homeCurrency&&quickBooksCurrency&&String(input.homeCurrency).trim().toUpperCase()!==quickBooksCurrency)throw new Error(`Certification currency must match the QuickBooks home currency (${quickBooksCurrency}).`)
  if(quickBooksCurrency)parameters.homeCurrency=quickBooksCurrency
  const started=await db.from('quickbooks_certification_runs').insert({id:runId,company_id:companyId,realm_id:connection.realmId,status:'RUNNING',parameters,reviewer_id:userId}).select('id').single();if(started.error)throw started.error
  try{
    const keys=[...CERTIFICATION_REPORTS]
    const quickBooksResults=await parallelMap(keys,4,async reportKey=>{
      const request=buildQuickBooksReportRequest(reportKey,parameters);const response=await provider.getReports!(connection.context,[request]);const raw=response[request.reportName]
      return {snapshot:normalizeQuickBooksReport(reportKey,raw,parameters),rawHash:hash(raw)}
    })
    const hisabResults=await parallelMap(keys,4,async reportKey=>{const snapshot=await generateHisabSnapshot(companyId,reportKey,parameters);return {snapshot,rawHash:hash(snapshot.raw)}})
    const sections:CertificationSection[]=[];const hisabSnapshots=new Map<string,FinancialReportSnapshot>()
    for(let index=0;index<keys.length;index++){
      const reportKey=keys[index],quickBooks=quickBooksResults[index],hisab=hisabResults[index]
      if(quickBooks.status==='rejected'){sections.push(unavailable(reportKey,`QuickBooks report unavailable: ${quickBooks.reason instanceof Error?quickBooks.reason.message:String(quickBooks.reason)}`));continue}
      if(hisab.status==='rejected'){sections.push(unavailable(reportKey,`Hisab report unavailable: ${hisab.reason instanceof Error?hisab.reason.message:String(hisab.reason)}`));continue}
      hisabSnapshots.set(reportKey,hisab.value.snapshot)
      sections.push(compareSnapshots({quickBooks:quickBooks.value.snapshot,hisab:hisab.value.snapshot,quickBooksHash:quickBooks.value.rawHash,hisabHash:hisab.value.rawHash}))
    }
    sections.push(validateCrossReportIntegrity(hisabSnapshots,parameters))
    const cross=sections.at(-1)!
    const [company,invalidFx,foreignFx]=await Promise.all([db.from('companies').select('currency').eq('id',companyId).single(),db.from('ledger_entries').select('id',{count:'exact',head:true}).eq('company_id',companyId).neq('currency',parameters.homeCurrency).or('exchange_rate.is.null,exchange_rate.lte.0'),db.from('ledger_entries').select('id',{count:'exact',head:true}).eq('company_id',companyId).neq('currency',parameters.homeCurrency)])
    if(company.error)throw company.error;if(invalidFx.error)throw invalidFx.error;if(foreignFx.error)throw foreignFx.error
    if(String(company.data.currency??'').toUpperCase()!==parameters.homeCurrency){cross.status='FAILED';cross.differences.push({reportKey:'cross-report',key:'home-currency',label:'Home currency',metric:'currency',quickBooksValue:1,hisabValue:0,difference:-1,materiality:0,severity:'ERROR',recommendedAction:`Set Hisab AI home currency to ${parameters.homeCurrency} before certification.`})}
    if((invalidFx.count??0)>0){cross.status='FAILED';cross.differences.push({reportKey:'cross-report',key:'fx-rates',label:'Foreign currency ledger entries',metric:'missing_exchange_rate',quickBooksValue:0,hisabValue:invalidFx.count??0,difference:invalidFx.count??0,materiality:0,severity:'ERROR',recommendedAction:'Repair missing historical exchange rates and regenerate FX postings.'})}
    if(parameters.multiCurrency||(foreignFx.count??0)>0){try{sections.push(...await certifyMultiCurrency({companyId,realmId:connection.realmId,provider,context:connection.context,parameters}))}catch(error){const message=`Multi-currency evidence unavailable: ${error instanceof Error?error.message:String(error)}`;for(const key of ['fx-exchange-rates','fx-transactions','fx-currency-balances','fx-realized','fx-unrealized','fx-revaluations','fx-accounts'] as const)sections.push(unavailable(key,message))}}
    try{sections.push(await certifyPaymentAllocations(companyId,connection.realmId,parameters))}catch(error){sections.push(unavailable('payment-allocations',`Payment allocation evidence unavailable: ${error instanceof Error?error.message:String(error)}`))}
    try{sections.push(await certifyDeposits(companyId,connection.realmId,parameters))}catch(error){sections.push(unavailable('deposit-reconciliation',`Deposit reconciliation evidence unavailable: ${error instanceof Error?error.message:String(error)}`))}
    try{sections.push(await certifyVendorCredits(companyId,connection.realmId,parameters))}catch(error){sections.push(unavailable('vendor-credit-reconciliation',`Vendor Credit reconciliation evidence unavailable: ${error instanceof Error?error.message:String(error)}`))}
    try{sections.push(await certifySalesReceipts(companyId,connection.realmId,parameters))}catch(error){sections.push(unavailable('sales-receipt-reconciliation',`Sales Receipt reconciliation evidence unavailable: ${error instanceof Error?error.message:String(error)}`))}
    try{sections.push(await certifyRetainedEarnings({companyId,realmId:connection.realmId,runId,provider,context:connection.context,parameters}))}catch(error){sections.push(unavailable('retained-earnings-reconciliation',`Retained Earnings proof unavailable: ${error instanceof Error?error.message:String(error)}`))}
    const materialization=await validateQuickBooksAccountingMaterialization(companyId)
    if(!materialization.passed){cross.status='FAILED';cross.label='Cross-report and materialization integrity';cross.matchedRows+=materialization.completed;cross.comparedRows+=materialization.completed+materialization.failed+materialization.conflicts+materialization.manualRequired;cross.differences.push(...materialization.issues.map(issue=>({reportKey:'cross-report' as const,key:issue.sourceId,label:`${issue.moduleKey} ${issue.sourceId}`,metric:issue.kind,quickBooksValue:1,hisabValue:0,difference:-1,materiality:0,severity:'ERROR' as const,recommendedAction:issue.message,sourceRefs:[{sourceId:issue.sourceId,documentId:issue.localId}]})))}
    const cutoff=await db.from('quickbooks_cutoff_reconciliations').select('id,status,result,reconciliation_date').eq('company_id',companyId).eq('realm_id',connection.realmId).eq('reconciliation_date',parameters.asOfDate).order('completed_at',{ascending:false}).limit(1).maybeSingle()
    if(cutoff.error)throw cutoff.error
    const cutoffReport=cutoff.data?.result as {summary?:{differenceCount?:number}}|null
    cross.comparedRows+=1
    if(!cutoff.data||cutoff.data.status!=='PASSED'){
      cross.status='FAILED';cross.label='Cross-report, materialization, and opening-balance integrity';cross.differences.push({reportKey:'cross-report',key:'opening-cutoff-reconciliation',label:'Opening balance and historical cutoff reconciliation',metric:'certified_roll_forward',quickBooksValue:1,hisabValue:0,difference:-1,materiality:0,severity:'ERROR',recommendedAction:`Run a passing opening-balance reconciliation through ${parameters.asOfDate} before certification.`})
    }else{cross.matchedRows+=1;if((cutoffReport?.summary?.differenceCount??0)>0)cross.label='Cross-report, materialization, and opening-balance integrity'}
    cross.maximumDifference=cross.differences.reduce((maximum,item)=>Math.max(maximum,Math.abs(item.difference)),cross.maximumDifference)
    const failed=sections.filter(section=>section.status==='FAILED'||section.status==='UNAVAILABLE').length;const warnings=sections.filter(section=>section.status==='WARNING').length
    const status=failed?'FAILED':warnings?'CERTIFIED_WITH_WARNINGS':'CERTIFIED';const summary={matched:sections.filter(section=>section.status==='MATCHED').length,warnings,failed:sections.filter(section=>section.status==='FAILED').length,unavailable:sections.filter(section=>section.status==='UNAVAILABLE').length,differenceCount:sections.reduce((sum,section)=>sum+section.differences.length,0)}
    const report:AccountingCertificationReport={id:runId,realmId:connection.realmId,generatedAt:new Date().toISOString(),status,parameters,sections,summary,reviewer:userId,approvalStatus:'PENDING'}
    const sectionRows=sections.map(section=>{const qb=quickBooksResults[keys.indexOf(section.reportKey as CertificationReportKey)];const hs=hisabResults[keys.indexOf(section.reportKey as CertificationReportKey)];return {run_id:runId,company_id:companyId,report_key:section.reportKey,status:section.status,quickbooks_hash:section.quickBooksHash??null,hisab_hash:section.hisabHash??null,quickbooks_snapshot:qb?.status==='fulfilled'?JSON.parse(canonicalSnapshot(qb.value.snapshot)):null,hisab_snapshot:hs?.status==='fulfilled'?JSON.parse(canonicalSnapshot(hs.value.snapshot)):null,comparison:section}})
    const persisted=await db.from('quickbooks_certification_sections').insert(sectionRows);if(persisted.error)throw persisted.error
    const completed=await db.from('quickbooks_certification_runs').update({status,report,completed_at:new Date().toISOString()}).eq('id',runId).eq('company_id',companyId);if(completed.error)throw completed.error
    return report
  }catch(error){await db.from('quickbooks_certification_runs').update({status:'FAILED',report:{error:error instanceof Error?error.message:String(error)},completed_at:new Date().toISOString()}).eq('id',runId).eq('company_id',companyId);throw error}
}

export async function getCertificationReports(companyId:string,runId?:string){const db=createAdminClient();let query=db.from('quickbooks_certification_runs').select('id,realm_id,status,parameters,report,reviewer_id,approval_status,approved_at,started_at,completed_at').eq('company_id',companyId).order('created_at',{ascending:false});if(runId)query=query.eq('id',runId);else query=query.limit(20);const result=await query;if(result.error)throw result.error;return result.data??[]}
export async function reviewCertification(companyId:string,userId:string,runId:string,approvalStatus:'APPROVED'|'REJECTED'){const db=createAdminClient();const existing=await db.from('quickbooks_certification_runs').select('status,report').eq('company_id',companyId).eq('id',runId).single();if(existing.error)throw existing.error;if(approvalStatus==='APPROVED'&&existing.data.status==='FAILED')throw new Error('A failed certification cannot be approved.');const report=existing.data.report&&typeof existing.data.report==='object'?{...(existing.data.report as Record<string,unknown>),reviewer:userId,approvalStatus}:existing.data.report;const result=await db.from('quickbooks_certification_runs').update({reviewer_id:userId,approval_status:approvalStatus,approved_at:new Date().toISOString(),report}).eq('company_id',companyId).eq('id',runId).select('id,approval_status,approved_at').single();if(result.error)throw result.error;return result.data}
