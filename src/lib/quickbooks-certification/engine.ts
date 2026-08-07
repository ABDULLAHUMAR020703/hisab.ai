import type { CertificationDifference, CertificationParameters, CertificationRow, CertificationSection, FinancialReportSnapshot } from './types'

const EPSILON=0.0000001
export function normalizedKey(value:unknown){return String(value??'').trim().toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()}
export function money(value:unknown){
  if(typeof value==='number') return Number.isFinite(value)?value:0
  const raw=String(value??'').trim(); if(!raw||raw==='-') return 0
  const negative=raw.startsWith('(')&&raw.endsWith(')')
  const parsed=Number(raw.replace(/[(),\s]/g,'').replace(/[^0-9.+-]/g,''))
  return Number.isFinite(parsed)?(negative?-Math.abs(parsed):parsed):0
}
export function canonicalSnapshot(snapshot:FinancialReportSnapshot){
  return JSON.stringify({reportKey:snapshot.reportKey,parameters:snapshot.parameters,currency:snapshot.currency,rows:[...snapshot.rows].sort((a,b)=>a.key.localeCompare(b.key)).map(row=>({...row,values:Object.fromEntries(Object.entries(row.values).sort())})),totals:Object.fromEntries(Object.entries(snapshot.totals).sort())})
}
export function allowedDifference(source:number,target:number,p:CertificationParameters){
  if(p.exact) return 0
  return Math.max(p.absoluteTolerance,Math.max(Math.abs(source),Math.abs(target))*p.relativeTolerance)
}
export function compareSnapshots(input:{quickBooks:FinancialReportSnapshot;hisab:FinancialReportSnapshot;quickBooksHash?:string;hisabHash?:string}):CertificationSection{
  const {quickBooks,hisab}=input; const differences:CertificationDifference[]=[]; let matchedRows=0; let maximumDifference=0
  if(quickBooks.currency.toUpperCase()!==hisab.currency.toUpperCase())differences.push({reportKey:quickBooks.reportKey,key:'report-currency',label:'Report currency',metric:'currency',quickBooksValue:1,hisabValue:0,difference:-1,materiality:0,severity:'ERROR',recommendedAction:`Generate both reports in ${quickBooks.currency.toUpperCase()}.`})
  const qb=new Map(quickBooks.rows.map(row=>[row.key,row])); const local=new Map(hisab.rows.map(row=>[row.key,row])); const keys=[...new Set([...qb.keys(),...local.keys()])].sort()
  for(const key of keys){
    const source=qb.get(key); const target=local.get(key); const metrics=[...new Set([...Object.keys(source?.values??{}),...Object.keys(target?.values??{})])]
    let matched=true
    for(const metric of metrics){
      const quickBooksValue=source?.values[metric]??0; const hisabValue=target?.values[metric]??0; const difference=Math.round((hisabValue-quickBooksValue)*100000000)/100000000; const materiality=allowedDifference(quickBooksValue,hisabValue,quickBooks.parameters)
      maximumDifference=Math.max(maximumDifference,Math.abs(difference))
      const sourceRefs=[...(source?.sourceRefs??[]),...(target?.sourceRefs??[])]
      if(Math.abs(difference)>materiality+EPSILON){matched=false;differences.push({reportKey:quickBooks.reportKey,key,label:source?.label??target?.label??key,metric,quickBooksValue,hisabValue,difference,materiality,severity:'ERROR',recommendedAction:!source?'Remove or explain the extra Hisab balance.':!target?'Materialize the missing QuickBooks balance.':'Trace the account to ledger entries and source documents.',sourceRefs})}
      else if(Math.abs(difference)>EPSILON){differences.push({reportKey:quickBooks.reportKey,key,label:source?.label??target?.label??key,metric,quickBooksValue,hisabValue,difference,materiality,severity:'WARNING',recommendedAction:'Review the immaterial rounding or currency difference.',sourceRefs})}
    }
    if(matched) matchedRows++
  }
  const errors=differences.filter(item=>item.severity==='ERROR').length; const warnings=differences.length-errors
  return {reportKey:quickBooks.reportKey,label:quickBooks.reportKey.replaceAll('-',' '),status:errors?'FAILED':warnings?'WARNING':'MATCHED',quickBooksHash:input.quickBooksHash,hisabHash:input.hisabHash,matchedRows,comparedRows:keys.length,maximumDifference,differences}
}

export function row(key:unknown,label:unknown,values:Record<string,unknown>,extra:Partial<CertificationRow>={}):CertificationRow{
  const clean=Object.fromEntries(Object.entries(values).map(([name,value])=>[normalizedKey(name).replaceAll(' ','_'),money(value)]))
  return {key:normalizedKey(key||label),label:String(label??key??''),values:clean,...extra}
}

export function aggregateRows(rows:CertificationRow[]):CertificationRow[]{
  const grouped=new Map<string,CertificationRow>()
  for(const current of rows){
    if(!current.key) continue
    const existing=grouped.get(current.key)??{...current,values:{},sourceRefs:[]}
    for(const [metric,value] of Object.entries(current.values)) existing.values[metric]=(existing.values[metric]??0)+value
    existing.sourceRefs=[...(existing.sourceRefs??[]),...(current.sourceRefs??[])]
    grouped.set(current.key,existing)
  }
  return [...grouped.values()]
}

export function certificationCsv(sections:CertificationSection[]){
  const output:Array<Array<unknown>>=[['Report','Status','Key','Label','Metric','QuickBooks','Hisab AI','Difference','Materiality','Severity','Recommended action']]
  for(const section of sections){if(!section.differences.length)output.push([section.label,section.status,'','','','','','','','','']);for(const item of section.differences)output.push([section.label,section.status,item.key,item.label,item.metric,item.quickBooksValue,item.hisabValue,item.difference,item.materiality,item.severity,item.recommendedAction])}
  return output.map(values=>values.map(value=>{const text=String(value??'');return /[",\r\n]/.test(text)?`"${text.replaceAll('"','""')}"`:text}).join(',')).join('\r\n')
}

export function validateCrossReportIntegrity(snapshots:Map<string,FinancialReportSnapshot>,parameters:CertificationParameters):CertificationSection{
  const differences:CertificationDifference[]=[]
  const check=(key:string,label:string,left:number,right:number,action:string)=>{const difference=Math.round((right-left)*100000000)/100000000;const materiality=allowedDifference(left,right,parameters);if(Math.abs(difference)>materiality+EPSILON)differences.push({reportKey:'cross-report',key,label,metric:'balance',quickBooksValue:left,hisabValue:right,difference,materiality,severity:'ERROR',recommendedAction:action})}
  const tb=snapshots.get('trial-balance');if(tb)check('debits-credits','Trial Balance debits equal credits',tb.totals.debit??0,tb.totals.credit??0,'Inspect unbalanced or incomplete posting batches.')
  const bs=snapshots.get('balance-sheet');if(bs){const by=(section:string)=>bs.rows.filter(item=>item.dimensions?.section===section).reduce((sum,item)=>sum+(item.values.ending_balance??0),0);check('accounting-equation','Assets equal liabilities plus equity',by('assets'),by('liabilities')+by('equity'),'Inspect balance-sheet classifications and retained earnings.')}
  const ar=snapshots.get('aged-ar');if(tb&&ar){const control=tb.rows.filter(item=>/receivable/.test(normalizedKey(item.label))).reduce((sum,item)=>sum+(item.values.ending_balance??(item.values.debit??0)-(item.values.credit??0)),0);check('ar-control','Accounts Receivable control equals AR aging',control,ar.totals.ending_balance??0,'Trace customer invoices, credits, and payments missing from the AR subledger.')}
  const ap=snapshots.get('aged-ap');if(tb&&ap){const control=tb.rows.filter(item=>/payable/.test(normalizedKey(item.label))&&!/tax|vat/.test(normalizedKey(item.label))).reduce((sum,item)=>sum+(item.values.ending_balance??(item.values.credit??0)-(item.values.debit??0)),0);check('ap-control','Accounts Payable control equals AP aging',control,ap.totals.ending_balance??0,'Trace vendor bills, credits, and payments missing from the AP subledger.')}
  const inventory=snapshots.get('inventory-valuation');if(tb&&inventory){const control=tb.rows.filter(item=>/inventory/.test(normalizedKey(item.label))).reduce((sum,item)=>sum+(item.values.ending_balance??(item.values.debit??0)-(item.values.credit??0)),0);check('inventory-control','Inventory asset equals inventory valuation',control,inventory.totals.value??0,'Rebuild inventory movements and costing layers for the affected items.')}
  const tax=snapshots.get('tax-summary');if(tb&&tax){const control=tb.rows.filter(item=>/tax|vat/.test(normalizedKey(item.label))).reduce((sum,item)=>sum+(item.values.ending_balance??(item.values.credit??0)-(item.values.debit??0)),0);const reported=tax.rows.filter(item=>/payable|liability|refund/.test(normalizedKey(item.label))).reduce((sum,item)=>sum+(item.values.amount??0),0);if(Math.abs(control)>EPSILON||Math.abs(reported)>EPSILON)check('tax-control','Tax control accounts equal tax report',control,reported,'Trace tax components and tax journals by source document.')}
  return {reportKey:'cross-report',label:'Cross-report accounting integrity',status:differences.length?'FAILED':'MATCHED',matchedRows:Math.max(0,5-differences.length),comparedRows:5,maximumDifference:differences.reduce((max,item)=>Math.max(max,Math.abs(item.difference)),0),differences}
}
