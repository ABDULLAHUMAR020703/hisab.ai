import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { buildFiscalProofPeriods,certifyRetainedEarningsPeriods,partitionReportRange,type RetainedEarningsPeriodEvidence } from '../../src/lib/quickbooks-certification/retained-earnings-engine'
import type { CertificationParameters } from '../../src/lib/quickbooks-certification/types'

const parameters:CertificationParameters={startDate:'2024-01-01',endDate:'2026-12-31',asOfDate:'2026-12-31',accountingBasis:'Accrual',homeCurrency:'USD',multiCurrency:false,exact:true,absoluteTolerance:0,relativeTolerance:0}
const period={key:'fy-2025',label:'Fiscal year 2025',startDate:'2025-01-01',endDate:'2025-12-31',isComplete:true}
const evidence=(values:Partial<RetainedEarningsPeriodEvidence['quickBooks']>={}):RetainedEarningsPeriodEvidence['quickBooks']=>({openingEquity:100,historicalNetIncome:40,ownerDrawings:10,adjustments:5,retainedEarnings:135,proofComplete:true,evidence:['Balance Sheet','Profit & Loss','General Ledger'],...values})
const row=(values:Partial<RetainedEarningsPeriodEvidence>={}):RetainedEarningsPeriodEvidence=>({period,quickBooks:evidence(),hisab:evidence(),fiscalCloseRequired:true,fiscalCloseProven:true,...values})

test('retained earnings equation includes income, drawings, and signed adjustments',()=>{const result=certifyRetainedEarningsPeriods([row()],parameters);assert.equal(result.status,'MATCHED');assert.equal(result.differences.length,0);const details=result.details as {equation:string;periods:Array<{hisab:{calculatedRetainedEarnings:number}}>} ;assert.match(details.equation,/Opening Equity \+ Historical Net Income - Owner Drawings \+ Adjustments/);assert.equal(details.periods[0].hisab.calculatedRetainedEarnings,135)})

test('every component produces an independently explained difference',()=>{const hisab=evidence({openingEquity:90,historicalNetIncome:35,ownerDrawings:8,adjustments:2,retainedEarnings:120}),result=certifyRetainedEarningsPeriods([row({hisab})],parameters),metrics=new Set(result.differences.map(item=>item.metric));for(const metric of ['openingEquity','historicalNetIncome','ownerDrawings','adjustments','retainedEarnings','hisabRollForward'])assert.ok(metrics.has(metric));assert.ok(result.differences.every(item=>item.recommendedAction.length>20))})

test('missing QuickBooks or Hisab evidence fails closed even when totals happen to match',()=>{const result=certifyRetainedEarningsPeriods([row({quickBooks:evidence({proofComplete:false,evidence:[]})})],parameters);assert.equal(result.status,'FAILED');assert.ok(result.differences.some(item=>item.metric==='proofEvidence'))})

test('a completed fiscal year cannot certify without its immutable close evidence',()=>{const result=certifyRetainedEarningsPeriods([row({fiscalCloseProven:false})],parameters);assert.equal(result.status,'FAILED');assert.ok(result.differences.some(item=>item.metric==='fiscalClose'))})

test('multiple calendar fiscal years are generated through the certification date',()=>{const periods=buildFiscalProofPeriods('2024-01-01','2026-12-31');assert.deepEqual(periods.map(item=>item.key),['fy-2024','fy-2025','fy-2026']);assert.ok(periods.every(item=>item.isComplete))})

test('non-calendar fiscal years use the company fiscal-year boundary',()=>{const periods=buildFiscalProofPeriods('2025-08-15','2026-08-31','07-01');assert.deepEqual(periods.map(item=>[item.startDate,item.endDate]),[['2025-07-01','2026-06-30'],['2026-07-01','2026-08-31']]);assert.equal(periods[0].isComplete,true);assert.equal(periods[1].isComplete,false)})

test('long QuickBooks report ranges are partitioned at six months without gaps',()=>{assert.deepEqual(partitionReportRange('2025-01-01','2025-12-31'),[{startDate:'2025-01-01',endDate:'2025-06-30'},{startDate:'2025-07-01',endDate:'2025-12-31'}])})

test('retained earnings certification persists period evidence and integrates cutoff and prior-period adjustments',()=>{const migration=readFileSync('supabase/migrations/060_retained_earnings_certification.sql','utf8'),source=readFileSync('src/lib/quickbooks-certification/retained-earnings.ts','utf8'),service=readFileSync('src/lib/quickbooks-certification/service.ts','utf8');assert.match(migration,/quickbooks_retained_earnings_periods/);assert.match(migration,/UNIQUE\(run_id,period_key\)/);for(const evidence of ['quickbooks_cutoff_reconciliations','fiscal_year_closings','OPENING_BALANCE','YEAR_CLOSE','ADJUSTMENT','priorPeriodAdjustments','GeneralLedgerDetail','ProfitAndLoss','BalanceSheet'])assert.match(source,new RegExp(evidence));assert.match(service,/certifyRetainedEarnings/);assert.match(service,/retained-earnings-reconciliation/)})

test('comparison remains deterministic across decades of fiscal periods',()=>{const rows=Array.from({length:100},(_,index)=>row({period:{...period,key:`fy-${1900+index}`,label:`Fiscal year ${1900+index}`}}));const result=certifyRetainedEarningsPeriods(rows,parameters);assert.equal(result.status,'MATCHED');assert.equal(result.matchedRows,900)})
