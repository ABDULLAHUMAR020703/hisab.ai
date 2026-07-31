import type { ProviderReportRequest } from '@/integrations/accounting/contracts/accounting-provider'
import { aggregateRows, money, normalizedKey, row } from './engine'
import type { CertificationParameters, CertificationReportKey, CertificationRow, FinancialReportSnapshot } from './types'

export const QUICKBOOKS_REPORT_NAMES:Record<CertificationReportKey,string>={
  'trial-balance':'TrialBalance','balance-sheet':'BalanceSheet','profit-loss':'ProfitAndLoss','general-ledger':'GeneralLedgerDetail',
  'aged-ar':'AgedReceivables','aged-ap':'AgedPayables','cash-flow':'CashFlow','inventory-valuation':'InventoryValuationSummary',
  'tax-summary':'TaxSummary','tax-detail':'TaxDetail','customer-balances':'CustomerBalance','vendor-balances':'VendorBalance',
}

export function buildQuickBooksReportRequest(reportKey:CertificationReportKey,parameters:CertificationParameters):ProviderReportRequest{
  const reportName=QUICKBOOKS_REPORT_NAMES[reportKey]
  const values:Record<string,string|number|boolean>={start_date:parameters.startDate,end_date:['balance-sheet','trial-balance','aged-ar','aged-ap','inventory-valuation','customer-balances','vendor-balances'].includes(reportKey)?parameters.asOfDate:parameters.endDate,accounting_method:parameters.accountingBasis,currency:parameters.homeCurrency}
  if(parameters.classIds?.length) values.class=parameters.classIds.join(',')
  if(parameters.departmentIds?.length) values.department=parameters.departmentIds.join(',')
  const customers=[...new Set([...(parameters.customerIds??[]),...(parameters.projectIds??[])])]
  if(customers.length) values.customer=customers.join(',')
  if(parameters.vendorIds?.length) values.vendor=parameters.vendorIds.join(',')
  return {reportName,parameters:values}
}

type QboRow={type?:string;Header?:{ColData?:Array<{value?:unknown;id?:string}>};ColData?:Array<{value?:unknown;id?:string}>;Rows?:{Row?:QboRow[]};Summary?:{ColData?:Array<{value?:unknown;id?:string}>}}
function metric(title:string,index:number,reportKey:CertificationReportKey){
  const key=normalizedKey(title).replaceAll(' ','_')
  if(/begin/.test(key))return 'beginning_balance';if(/debit/.test(key))return 'debit';if(/credit/.test(key))return 'credit'
  if(key==='current')return 'current';if(/1_?30/.test(key))return 'age_1_30';if(/31_?60/.test(key))return 'age_31_60';if(/61_?90/.test(key))return 'age_61_90';if(/9[01].*(over|plus)|90_?\+/.test(key))return 'age_90_plus'
  if(/quantity|qty/.test(key))return 'quantity';if(/value|asset/.test(key))return 'value'
  if(/ending|balance/.test(key))return 'ending_balance'
  if(/amount|total/.test(key)){if(reportKey==='inventory-valuation')return 'value';if(['aged-ar','aged-ap','customer-balances','vendor-balances','balance-sheet'].includes(reportKey))return 'ending_balance';return 'amount'}
  if(['profit-loss','cash-flow','tax-summary','tax-detail'].includes(reportKey))return 'amount'
  if(['balance-sheet','customer-balances','vendor-balances'].includes(reportKey))return 'ending_balance'
  return `value_${index}`
}
function numericCell(value:unknown){if(typeof value==='number')return Number.isFinite(value);const text=String(value??'').trim();return Boolean(text)&&/^[($€£¥₹\s,+\-.0-9)]+$/.test(text)&&/[0-9]/.test(text)}
export function normalizeQuickBooksReport(reportKey:CertificationReportKey,payload:unknown,parameters:CertificationParameters):FinancialReportSnapshot{
  const object=(payload&&typeof payload==='object'?payload:{}) as Record<string,unknown>; const columns=(((object.Columns as Record<string,unknown>|undefined)?.Column??[]) as Array<Record<string,unknown>>)
  const titles=columns.map((column,index)=>String(column.ColTitle??column.ColType??`Column ${index}`)); const rows:CertificationRow[]=[]
  function walk(items:QboRow[],parent=''){
    for(const item of items){
      const header=item.Header?.ColData??[]; const section=String(header[0]?.value??parent)
      const cells=item.ColData??[]
      if(cells.length){
        const label=String(cells[0]?.value??section); const values:Record<string,unknown>={};const dimensions:Record<string,string>={}
        for(let index=1;index<cells.length;index++){const raw=cells[index]?.value;const title=normalizedKey(titles[index]??'');if(numericCell(raw))values[metric(titles[index]??'',index,reportKey)]=money(raw);else if(raw&&/class|department|project|customer|vendor/.test(title))dimensions[title.includes('class')?'class':title.includes('department')?'department':title.includes('project')?'project':title.includes('customer')?'customer':'vendor']=String(raw)}
        const dimensionKey=Object.entries(dimensions).sort().map(([key,value])=>`${key}:${normalizedKey(value)}`).join('|')
        if(Object.keys(values).length) rows.push(row(reportKey==='general-ledger'?`${section||label}|${dimensionKey}`:label,label,values,{dimensions:{...(section&&section!==label?{section}:{}),...dimensions},sourceRefs:cells.some(cell=>cell.id)?[{sourceId:String(cells.find(cell=>cell.id)?.id)}]:undefined}))
      }
      if(item.Rows?.Row)walk(item.Rows.Row,section||parent)
    }
  }
  walk((((object.Rows as Record<string,unknown>|undefined)?.Row??[]) as QboRow[]))
  const normalized=aggregateRows(rows); const totals:Record<string,number>={}
  for(const current of normalized)for(const [key,value] of Object.entries(current.values))totals[key]=(totals[key]??0)+value
  return {reportKey,parameters,currency:parameters.homeCurrency,rows:normalized,totals,raw:payload}
}
