import type { CertificationDifference,CertificationParameters,CertificationSection } from './types'

export interface FiscalProofPeriod { key:string;label:string;startDate:string;endDate:string;isComplete:boolean }
export interface RetainedEarningsEvidence {
  openingEquity:number
  historicalNetIncome:number
  ownerDrawings:number
  adjustments:number
  retainedEarnings:number
  proofComplete:boolean
  evidence:string[]
  breakdown?:Record<string,number>
}
export interface RetainedEarningsPeriodEvidence { period:FiscalProofPeriod;quickBooks:RetainedEarningsEvidence;hisab:RetainedEarningsEvidence;fiscalCloseRequired:boolean;fiscalCloseProven:boolean;cutoffBasis?:string|null }

const round=(value:number)=>Math.round(value*1000000)/1000000
const endOfDay=(date:string)=>new Date(`${date}T23:59:59.999Z`)
const iso=(date:Date)=>date.toISOString().slice(0,10)
const addDays=(value:string,days:number)=>{const date=new Date(`${value}T00:00:00Z`);date.setUTCDate(date.getUTCDate()+days);return iso(date)}

export function buildFiscalProofPeriods(startDate:string,endDate:string,fiscalYearStart='01-01'):FiscalProofPeriod[]{
  const [rawMonth,rawDay]=fiscalYearStart.split('-').map(Number),month=Math.min(12,Math.max(1,rawMonth||1)),day=Math.min(28,Math.max(1,rawDay||1)),start=new Date(`${startDate}T00:00:00Z`),end=endOfDay(endDate)
  let boundary=new Date(Date.UTC(start.getUTCFullYear(),month-1,day));if(boundary>start)boundary=new Date(Date.UTC(start.getUTCFullYear()-1,month-1,day))
  const periods:FiscalProofPeriod[]=[]
  while(boundary<=end){const next=new Date(Date.UTC(boundary.getUTCFullYear()+1,month-1,day)),periodEnd=new Date(next.getTime()-1),effectiveEnd=periodEnd<end?periodEnd:end,labelYear=periodEnd.getUTCFullYear();periods.push({key:`fy-${labelYear}`,label:`Fiscal year ${labelYear}`,startDate:iso(boundary),endDate:iso(effectiveEnd),isComplete:periodEnd<=end});boundary=next}
  return periods
}

export function partitionReportRange(startDate:string,endDate:string,maxMonths=6){const ranges:Array<{startDate:string;endDate:string}>=[];let cursor=new Date(`${startDate}T00:00:00Z`);const end=new Date(`${endDate}T00:00:00Z`);while(cursor<=end){const next=new Date(cursor);next.setUTCMonth(next.getUTCMonth()+maxMonths);next.setUTCDate(next.getUTCDate()-1);const chunkEnd=next<end?next:end;ranges.push({startDate:iso(cursor),endDate:iso(chunkEnd)});cursor=new Date(chunkEnd);cursor.setUTCDate(cursor.getUTCDate()+1)}return ranges}

function difference(period:FiscalProofPeriod,metric:string,label:string,quickBooksValue:number,hisabValue:number,parameters:CertificationParameters,recommendedAction:string):CertificationDifference|null{const delta=round(hisabValue-quickBooksValue),allowed=parameters.exact?0:Math.max(parameters.absoluteTolerance,Math.abs(quickBooksValue)*parameters.relativeTolerance);if(Math.abs(delta)<=allowed)return null;return {reportKey:'retained-earnings-reconciliation',key:`${period.key}:${metric}`,label:`${period.label}: ${label}`,metric,quickBooksValue:round(quickBooksValue),hisabValue:round(hisabValue),difference:delta,materiality:allowed,severity:'ERROR',recommendedAction}}

export function certifyRetainedEarningsPeriods(rows:RetainedEarningsPeriodEvidence[],parameters:CertificationParameters):CertificationSection{
  const differences:CertificationDifference[]=[];let matchedRows=0,comparedRows=0
  for(const row of rows){const qbExpected=round(row.quickBooks.openingEquity+row.quickBooks.historicalNetIncome-row.quickBooks.ownerDrawings+row.quickBooks.adjustments),hisabExpected=round(row.hisab.openingEquity+row.hisab.historicalNetIncome-row.hisab.ownerDrawings+row.hisab.adjustments)
    const checks:Array<CertificationDifference|null>=[
      difference(row.period,'quickbooksRollForward','QuickBooks roll-forward',row.quickBooks.retainedEarnings,qbExpected,parameters,'Inspect the QuickBooks Balance Sheet, Profit & Loss, drawings, and retained-earnings General Ledger activity for this period.'),
      difference(row.period,'hisabRollForward','Hisab roll-forward',row.hisab.retainedEarnings,hisabExpected,parameters,'Repair opening equity, historical postings, drawings, adjustments, or fiscal-close journals in Hisab AI.'),
      difference(row.period,'openingEquity','Opening equity',row.quickBooks.openingEquity,row.hisab.openingEquity,parameters,'Reconcile the opening retained-earnings/equity balance, including the migration-cutoff opening journal.'),
      difference(row.period,'historicalNetIncome','Historical net income',row.quickBooks.historicalNetIncome,row.hisab.historicalNetIncome,parameters,'Compare period revenue, COGS, and expense postings against the QuickBooks Profit & Loss report.'),
      difference(row.period,'ownerDrawings','Owner drawings',row.quickBooks.ownerDrawings,row.hisab.ownerDrawings,parameters,'Map and reconcile owner drawings, distributions, dividends, and withdrawals.'),
      difference(row.period,'adjustments','Prior-period and direct adjustments',row.quickBooks.adjustments,row.hisab.adjustments,parameters,'Trace direct retained-earnings and prior-period adjustment journals in both ledgers.'),
      difference(row.period,'retainedEarnings','Closing retained earnings',row.quickBooks.retainedEarnings,row.hisab.retainedEarnings,parameters,'Reconcile the closing retained-earnings balance to the QuickBooks Balance Sheet.'),
    ]
    for(const item of checks){comparedRows++;if(item)differences.push(item);else matchedRows++}
    if(!row.quickBooks.proofComplete||!row.hisab.proofComplete){comparedRows++;differences.push({reportKey:'retained-earnings-reconciliation',key:`${row.period.key}:evidence`,label:`${row.period.label}: complete evidence`,metric:'proofEvidence',quickBooksValue:row.quickBooks.proofComplete?1:0,hisabValue:row.hisab.proofComplete?1:0,difference:-1,materiality:0,severity:'ERROR',recommendedAction:'Restore every required Balance Sheet, Profit & Loss, General Ledger, account-mapping, and cutoff evidence item before certification.'})}
    else matchedRows++
    if(row.fiscalCloseRequired){comparedRows++;if(!row.fiscalCloseProven)differences.push({reportKey:'retained-earnings-reconciliation',key:`${row.period.key}:fiscal-close`,label:`${row.period.label}: fiscal-year close`,metric:'fiscalClose',quickBooksValue:1,hisabValue:0,difference:-1,materiality:0,severity:'ERROR',recommendedAction:'Create or repair the immutable fiscal-year closing journal and its linked next-period opening record.'});else matchedRows++}
  }
  return {reportKey:'retained-earnings-reconciliation',label:'Retained Earnings by fiscal period',status:differences.length?'FAILED':'MATCHED',matchedRows,comparedRows,maximumDifference:differences.reduce((max,item)=>Math.max(max,Math.abs(item.difference)),0),differences,details:{equation:'Opening Equity + Historical Net Income - Owner Drawings + Adjustments = Retained Earnings',periods:rows.map(row=>({...row,quickBooks:{...row.quickBooks,calculatedRetainedEarnings:round(row.quickBooks.openingEquity+row.quickBooks.historicalNetIncome-row.quickBooks.ownerDrawings+row.quickBooks.adjustments)},hisab:{...row.hisab,calculatedRetainedEarnings:round(row.hisab.openingEquity+row.hisab.historicalNetIncome-row.hisab.ownerDrawings+row.hisab.adjustments)}}))}}
}

export const previousDate=(date:string)=>addDays(date,-1)
