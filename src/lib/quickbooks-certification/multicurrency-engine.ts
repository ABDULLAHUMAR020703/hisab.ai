import { allowedDifference,money,normalizedKey } from './engine'
import type { CertificationAuxiliaryKey,CertificationDifference,CertificationParameters,CertificationSection } from './types'

export interface FxComparableRow{key:string;label:string;currency:string;values:Record<string,number>;sourceId?:string;localId?:string}
export interface QuickBooksFxLedgerRow{key:string;account:string;currency:string;date:string;transactionType:string;documentNumber:string;memo:string;foreignAmount:number|null;homeAmount:number;exchangeRate:number|null;sourceId?:string;classification:'REALIZED'|'UNREALIZED'|'STANDARD';isFxAccount:boolean}
type Row={Header?:{ColData?:Cell[]};ColData?:Cell[];Rows?:{Row?:Row[]}}
type Cell={value?:unknown;id?:string}

const findIndex=(titles:string[],patterns:RegExp[])=>titles.findIndex(title=>patterns.some(pattern=>pattern.test(title)))
export function parseQuickBooksFxGeneralLedger(payload:unknown,homeCurrency:string):{rows:QuickBooksFxLedgerRow[];missingForeignEvidence:number;reportCurrency:string|null}{
  const object=(payload&&typeof payload==='object'?payload:{}) as Record<string,unknown>,columns=((((object.Columns as Record<string,unknown>|undefined)?.Column??[]) as Array<Record<string,unknown>>)),titles=columns.map(column=>normalizedKey(column.ColTitle??column.ColType).replaceAll(' ','_'))
  const accountIndex=findIndex(titles,[/^account/,/account_name/]),dateIndex=findIndex(titles,[/^date$/, /tx_date/]),typeIndex=findIndex(titles,[/txn_type/,/transaction_type/]),docIndex=findIndex(titles,[/doc_num/,/document/]),memoIndex=findIndex(titles,[/memo/,/description/]),currencyIndex=findIndex(titles,[/^currency$/]),rateIndex=findIndex(titles,[/exch.*rate/,/exchange_rate/]),foreignIndex=findIndex(titles,[/foreign.*amount/,/amount.*foreign/]),amountIndex=findIndex(titles,[/^amount$/, /home.*amount/])
  const result:QuickBooksFxLedgerRow[]=[];let missingForeignEvidence=0
  const cell=(cells:Cell[],index:number)=>index>=0?cells[index]:undefined
  function walk(items:Row[],parent=''){
    for(const item of items){const header=item.Header?.ColData??[],section=String(header[0]?.value??parent),cells=item.ColData??[]
      if(cells.length){const account=String(cell(cells,accountIndex)?.value??section),currency=String(cell(cells,currencyIndex)?.value??homeCurrency).toUpperCase(),date=String(cell(cells,dateIndex)?.value??''),transactionType=String(cell(cells,typeIndex)?.value??''),documentNumber=String(cell(cells,docIndex)?.value??''),memo=String(cell(cells,memoIndex)?.value??''),foreignRaw=cell(cells,foreignIndex)?.value,rateRaw=cell(cells,rateIndex)?.value,homeAmount=money(cell(cells,amountIndex)?.value),foreignAmount=foreignRaw===undefined||foreignRaw===null||String(foreignRaw).trim()===''?null:money(foreignRaw),exchangeRate=rateRaw===undefined||rateRaw===null||String(rateRaw).trim()===''?null:money(rateRaw),evidence=`${account} ${memo} ${transactionType}`.toLowerCase(),isFxAccount=/(exchange|foreign|\bfx\b).*(gain|loss)|(gain|loss).*(exchange|foreign|\bfx\b)/.test(account.toLowerCase()),classification=/unrealized|revalu|home currency adjustment/.test(evidence)?'UNREALIZED':isFxAccount?'REALIZED':'STANDARD';if(currency!==homeCurrency&&foreignAmount===null)missingForeignEvidence++;result.push({key:normalizedKey(`${account}|${currency}|${date}|${transactionType}|${documentNumber}|${result.length}`),account,currency,date,transactionType,documentNumber,memo,foreignAmount,homeAmount,exchangeRate,sourceId:cells.find(item=>item.id)?.id,classification,isFxAccount})}
      if(item.Rows?.Row)walk(item.Rows.Row,section||parent)
    }
  }
  walk((((object.Rows as Record<string,unknown>|undefined)?.Row??[]) as Row[]))
  const header=(object.Header&&typeof object.Header==='object'?object.Header:{}) as Record<string,unknown>
  return {rows:result,missingForeignEvidence,reportCurrency:header.Currency?String(header.Currency).toUpperCase():null}
}

export function compareFxRows(reportKey:CertificationAuxiliaryKey,label:string,sourceRows:FxComparableRow[],hisabRows:FxComparableRow[],parameters:CertificationParameters):CertificationSection{
  const source=new Map(sourceRows.map(row=>[row.key,row])),hisab=new Map(hisabRows.map(row=>[row.key,row])),differences:CertificationDifference[]=[];let matchedRows=0,maximumDifference=0
  for(const key of [...new Set([...source.keys(),...hisab.keys()])].sort()){const left=source.get(key),right=hisab.get(key),metrics=[...new Set([...Object.keys(left?.values??{}),...Object.keys(right?.values??{})])];let matched=true
    for(const metric of metrics){const quickBooksValue=left?.values[metric]??0,hisabValue=right?.values[metric]??0,difference=Math.round((hisabValue-quickBooksValue)*1e8)/1e8,materiality=allowedDifference(quickBooksValue,hisabValue,parameters);maximumDifference=Math.max(maximumDifference,Math.abs(difference));if(Math.abs(difference)>materiality+1e-7){matched=false;differences.push({reportKey,key,label:left?.label??right?.label??key,metric,quickBooksValue,hisabValue,difference,materiality,severity:'ERROR',recommendedAction:!left?'Remove or explain the extra Hisab FX evidence.':!right?'Migrate the missing QuickBooks currency evidence.':'Trace the transaction rate, currency amounts, and FX journal postings.',sourceRefs:[{sourceId:left?.sourceId,documentId:right?.localId}]})}else if(Math.abs(difference)>1e-7)differences.push({reportKey,key,label:left?.label??right?.label??key,metric,quickBooksValue,hisabValue,difference,materiality,severity:'WARNING',recommendedAction:'Review the immaterial FX rounding difference.',sourceRefs:[{sourceId:left?.sourceId,documentId:right?.localId}]})}
    if(matched)matchedRows++
  }
  const errors=differences.filter(item=>item.severity==='ERROR').length;return {reportKey,label,status:errors?'FAILED':differences.length?'WARNING':'MATCHED',matchedRows,comparedRows:new Set([...source.keys(),...hisab.keys()]).size,maximumDifference,differences}
}
