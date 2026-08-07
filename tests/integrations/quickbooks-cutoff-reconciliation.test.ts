import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { openingAsOfDate,reconcileCutoffBalances } from '../../src/lib/quickbooks-cutoff/engine'

test('cutoff modes choose the mathematically correct opening snapshot',()=>{
  assert.equal(openingAsOfDate('HYBRID','2026-07-01','2026-07-31'),'2026-06-30')
  assert.equal(openingAsOfDate('OPENING_BALANCE_ONLY','2026-07-01','2026-07-31'),'2026-07-31')
  assert.equal(openingAsOfDate('FULL_HISTORY','2026-07-01','2026-07-31'),'2026-07-01')
})

test('hybrid roll-forward certifies opening plus historical movement and Hisab closing',()=>{
  const result=reconcileCutoffBalances('gl','General Ledger',[{key:'cash',label:'Cash',opening:1000,movement:250,quickBooksClosing:1250,hisabClosing:1250,currency:'USD'}],0.01)
  assert.equal(result.status,'MATCHED');assert.equal(result.matched,1);assert.equal(result.differences.length,0)
})

test('opening and historical movement differences are independently visible',()=>{
  const result=reconcileCutoffBalances('gl','General Ledger',[{key:'cash',label:'Cash',opening:1000,movement:200,quickBooksClosing:1250,hisabClosing:1240,currency:'USD'}],0.01)
  assert.equal(result.status,'FAILED');assert.equal(result.differences[0].expectedClosing,1200);assert.equal(result.differences[0].rollForwardDifference,-50);assert.equal(result.differences[0].closingDifference,-10)
})

test('rounding tolerance warns while exact mode fails',()=>{
  const balance={key:'tax',label:'Tax liability',opening:100,movement:0.004,quickBooksClosing:100,hisabClosing:100.004,currency:'USD'}
  assert.equal(reconcileCutoffBalances('tax','Tax',[balance],0.01,false).status,'WARNING')
  assert.equal(reconcileCutoffBalances('tax','Tax',[balance],0,true).status,'FAILED')
})

test('large account roll-forwards remain deterministic',()=>{
  const rows=Array.from({length:100000},(_,index)=>({key:`account-${index}`,label:`Account ${index}`,opening:index,movement:index/10,quickBooksClosing:index+index/10,hisabClosing:index+index/10,currency:'USD'}))
  const result=reconcileCutoffBalances('gl','General Ledger',rows,0.01)
  assert.equal(result.status,'MATCHED');assert.equal(result.matched,100000)
})

test('database and posting guards make retries idempotent',()=>{
  const migration=readFileSync('supabase/migrations/054_quickbooks_cutoff_reconciliation.sql','utf8')
  const posting=readFileSync('src/lib/accounting/opening-balances.ts','utf8')
  assert.match(migration,/UNIQUE\(company_id,realm_id,mode,cutoff_date,reconciliation_date\)/)
  assert.match(migration,/journal_entries_cutoff_opening_key_idx/)
  assert.match(migration,/stock_movements_cutoff_opening_key_idx/)
  assert.match(posting,/legacyId=`quickbooks-cutoff:/)
  assert.match(posting,/existing\.data\?\.status==='POSTED'/)
})

test('accounting certification requires a passing cutoff reconciliation',()=>{
  const certification=readFileSync('src/lib/quickbooks-certification/service.ts','utf8')
  assert.match(certification,/quickbooks_cutoff_reconciliations/)
  assert.match(certification,/opening-cutoff-reconciliation/)
  assert.match(certification,/cutoff\.data\.status!=='PASSED'/)
})
