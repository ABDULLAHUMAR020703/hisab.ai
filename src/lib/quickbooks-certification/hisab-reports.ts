import 'server-only'
import { runReport } from '@/lib/reporting/runner'
import { aggregateRows, row } from './engine'
import type { CertificationParameters, CertificationReportKey, CertificationRow, FinancialReportSnapshot } from './types'

const REPORT_KEY:Partial<Record<CertificationReportKey,string>>={'trial-balance':'trial-balance','balance-sheet':'balance-sheet','profit-loss':'profit-loss','general-ledger':'general-ledger','aged-ar':'aged-ar','aged-ap':'aged-ap','cash-flow':'cash-flow','inventory-valuation':'inventory-valuation','tax-summary':'tax-report','tax-detail':'tax-report'}
type Any=Record<string,unknown>
const record=(value:unknown):Any=>value&&typeof value==='object'?value as Any:{}
const array=(value:unknown):Any[]=>Array.isArray(value)?value as Any[]:[]

function normalize(reportKey:CertificationReportKey,data:unknown):CertificationRow[]{
  const value=record(data)
  if(reportKey==='trial-balance')return array(value.rows).map(item=>{const balance=Number(item.balance??0);const normal=String(item.normalBalance??'DEBIT');const debit=normal==='DEBIT'?Math.max(0,balance):Math.max(0,-balance);const credit=normal==='CREDIT'?Math.max(0,balance):Math.max(0,-balance);return row(item.accountName,item.accountName,{debit,credit},{sourceRefs:[{sourceType:'ACCOUNT',documentId:String(item.accountId??'')}]})})
  if(reportKey==='balance-sheet')return ['assets','liabilities','equity'].flatMap(section=>array(record(value[section]).items).map(item=>row(item.name,item.name,{ending_balance:item.balance},{dimensions:{section},sourceRefs:[{sourceType:'ACCOUNT',documentId:String(item.accountId??'')}]})))
  if(reportKey==='profit-loss')return [...array(record(value.revenue).byAccount).map(item=>row(item.name,item.name,{amount:item.amount},{dimensions:{section:'revenue'},sourceRefs:[{sourceType:'ACCOUNT',documentId:String(item.accountId??'')}]})),...array(record(value.expenses).byAccount).map(item=>row(item.name,item.name,{amount:item.amount},{dimensions:{section:'expense'},sourceRefs:[{sourceType:'ACCOUNT',documentId:String(item.accountId??'')}]})),row('cost of goods sold','Cost of Goods Sold',{amount:record(value.cogs).total})]
  if(reportKey==='general-ledger')return aggregateRows(array(value.entries).map(item=>{const account=record(item.account);const costCenter=record(item.costCenter);const dimensionName=String(costCenter.name??'');const rawType=String(costCenter.type??'').toLowerCase();const type=rawType==='location'?'department':rawType;const dimensionKey=dimensionName&&['class','project','department'].includes(type)?`${type}:${dimensionName.toLowerCase()}`:'';return row(`${account.name??''}|${dimensionKey}`,account.name,{debit:item.debit,credit:item.credit},{dimensions:dimensionName?{[type||'costCenter']:dimensionName}:{},sourceRefs:[{sourceType:String(item.sourceType??''),sourceId:String(item.sourceId??''),documentId:String(item.sourceId??'')}]})}))
  if(reportKey==='aged-ar')return aggregateRows(array(value.details).map(item=>row(item.customerName,item.customerName,{ending_balance:item.balance,[String(item.bucket)==='current'?'current':`age_${String(item.bucket).replace('-','_').replace('+','_plus')}`]:item.balance},{sourceRefs:[{sourceType:'INVOICE',documentId:String(item.id??'')}] })))
  if(reportKey==='aged-ap')return aggregateRows(array(value.details).map(item=>row(item.vendorName,item.vendorName,{ending_balance:item.balance,[String(item.bucket)==='current'?'current':`age_${String(item.bucket).replace('-','_').replace('+','_plus')}`]:item.balance},{sourceRefs:[{sourceType:'BILL',documentId:String(item.id??'')}] })))
  if(reportKey==='inventory-valuation')return aggregateRows(array(value.rows).map(item=>row(item.itemName,item.itemName,{quantity:item.quantityOnHand,value:item.totalValue},{dimensions:{warehouse:String(item.warehouseName??'' )}})))
  if(reportKey==='tax-summary'||reportKey==='tax-detail')return array(value.rows).map(item=>row(item.line,item.line,{amount:item.amount}))
  if(reportKey==='cash-flow'){const rows=array(value.rows??value.months);return rows.map(item=>row(item.accountNo??item.month??item.name,item.accountName??item.month??item.name,{amount:item.net??item.amount,inflows:item.inflows,outflows:item.outflows}))}
  return []
}

export async function generateHisabSnapshot(companyId:string,reportKey:CertificationReportKey,parameters:CertificationParameters):Promise<FinancialReportSnapshot>{
  if(parameters.accountingBasis==='Cash')throw new Error('Hisab AI cash-basis financial reporting is not available for certification.')
  if([parameters.classIds,parameters.departmentIds,parameters.projectIds,parameters.customerIds,parameters.vendorIds].some(values=>values?.length))throw new Error('The existing Hisab financial reports do not consistently apply all requested dimension filters; an unfiltered report cannot be certified against a filtered QuickBooks report.')
  let data:unknown
  if(reportKey==='general-ledger'){
    const entries:Any[]=[];let page=1;const pageSize=1000;let total=0
    do{const result=await runReport({reportKey:'general-ledger',period:{from:parameters.startDate,to:parameters.endDate,preset:'custom'},companyId,page,pageSize});const current=record(result.data);entries.push(...array(current.entries));total=Number(record(current.pagination).total??entries.length);page++}while(entries.length<total)
    data={entries,pagination:{total,limit:pageSize,offset:0}}
  }
  if(reportKey==='customer-balances')data=(await runReport({reportKey:'aged-ar',asOf:parameters.asOfDate,companyId,pageSize:100000})).data
  else if(reportKey==='vendor-balances')data=(await runReport({reportKey:'aged-ap',asOf:parameters.asOfDate,companyId,pageSize:100000})).data
  else if(reportKey!=='general-ledger'){const key=REPORT_KEY[reportKey];if(!key)throw new Error(`No equivalent Hisab report for ${reportKey}.`);data=(await runReport({reportKey:key,period:{from:parameters.startDate,to:parameters.endDate,preset:'custom'},asOf:parameters.asOfDate,companyId,pageSize:100000})).data}
  const sourceKey=reportKey==='customer-balances'?'aged-ar':reportKey==='vendor-balances'?'aged-ap':reportKey
  const rows=normalize(sourceKey as CertificationReportKey,data);const totals:Record<string,number>={};for(const current of rows)for(const [key,value] of Object.entries(current.values))totals[key]=(totals[key]??0)+value
  return {reportKey,parameters,currency:parameters.homeCurrency,rows,totals,raw:data}
}
