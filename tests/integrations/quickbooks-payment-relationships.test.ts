import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { extractQuickBooksPaymentRelationships } from '../../src/lib/import-export/quickbooks/payment-relationships'

const linked=(amount:number,targetType:string,targetId:string,extra:Array<{TxnType:string;TxnId:string}>=[])=>({Amount:amount,LinkedTxn:[{TxnType:targetType,TxnId:targetId},...extra]})

test('one QuickBooks payment preserves split allocations across multiple invoices',()=>{const result=extractQuickBooksPaymentRelationships({TotalAmt:100,UnappliedAmt:0,Line:[linked(60,'Invoice','INV-1'),linked(40,'Invoice','INV-2')]},'CUSTOMER');assert.equal(result.issues.length,0);assert.equal(result.allocations.length,2);assert.deepEqual(result.allocations.map(item=>[item.targetSourceId,item.amount,item.cashAmount]),[['INV-1',60,60],['INV-2',40,40]]);assert.equal(result.appliedAmount,100)})

test('partial invoice payments retain the exact applied and remaining cash state',()=>{const result=extractQuickBooksPaymentRelationships({TotalAmt:30,UnappliedAmt:0,Line:[linked(30,'Invoice','INV-1')]},'CUSTOMER');assert.equal(result.allocations[0].amount,30);assert.equal(result.appliedAmount,30);assert.equal(result.unappliedAmount,0)})

test('overpayments remain unapplied instead of being duplicated across invoices',()=>{const result=extractQuickBooksPaymentRelationships({TotalAmt:120,UnappliedAmt:20,Line:[linked(70,'Invoice','INV-1'),linked(30,'Invoice','INV-2')]},'CUSTOMER');assert.equal(result.issues.length,0);assert.equal(result.paymentAmount,120);assert.equal(result.appliedAmount,100);assert.equal(result.unappliedAmount,20)})

test('credits applied during a customer payment retain cash, credit, and source relationship separately',()=>{const result=extractQuickBooksPaymentRelationships({TotalAmt:100,UnappliedAmt:0,Line:[linked(130,'Invoice','INV-1',[{TxnType:'CreditMemo',TxnId:'CM-7'}])]},'CUSTOMER');assert.equal(result.issues.length,0);assert.deepEqual(result.allocations[0].creditSourceIds,['CM-7']);assert.equal(result.allocations[0].cashAmount,100);assert.equal(result.allocations[0].creditAmount,30);assert.equal(result.creditAppliedAmount,30)})

test('credit application fails closed when QuickBooks does not identify an exact credit amount per document',()=>{const result=extractQuickBooksPaymentRelationships({TotalAmt:100,Line:[linked(130,'Invoice','INV-1',[{TxnType:'CreditMemo',TxnId:'CM-1'},{TxnType:'CreditMemo',TxnId:'CM-2'}])]},'CUSTOMER');assert.match(result.issues.join(' '),/exactly one credit/)})

test('one vendor payment preserves allocations across multiple bills',()=>{const result=extractQuickBooksPaymentRelationships({TotalAmt:100,Line:[linked(45,'Bill','BILL-1'),linked(55,'Bill','BILL-2')]},'VENDOR');assert.equal(result.issues.length,0);assert.deepEqual(result.allocations.map(item=>item.targetSourceId),['BILL-1','BILL-2']);assert.equal(result.appliedAmount,100)})

test('ambiguous linked targets fail validation rather than inventing an allocation',()=>{const result=extractQuickBooksPaymentRelationships({TotalAmt:100,Line:[{Amount:100,LinkedTxn:[{TxnType:'Invoice',TxnId:'INV-1'},{TxnType:'Invoice',TxnId:'INV-2'}]}]},'CUSTOMER');assert.equal(result.allocations.length,0);assert.match(result.issues[0],/ambiguous/)})

test('allocation migration is tenant-safe, atomic, and idempotent',()=>{const sql=readFileSync('supabase/migrations/056_payment_allocations.sql','utf8');assert.match(sql,/UNIQUE \(company_id,payment_id,source_system,source_line_key\)/);assert.match(sql,/replace_payment_allocations/);assert.match(sql,/FOR UPDATE/);assert.match(sql,/Cash allocations exceed payment amount/);assert.match(sql,/refresh_payment_document_balances/)})

test('an exact posted QuickBooks payment re-import is a no-op while changed allocations conflict',()=>{const importer=readFileSync('src/lib/import-export/registry/modules/transactions.module.ts','utf8');assert.match(importer,/paymentAllocationsMatch/);assert.match(importer,/&&await paymentAllocationsMatch/);assert.match(importer,/Resolve the conflict instead of rewriting ledger history/)})

test('AR and AP aging include unapplied payments and remaining customer or vendor credits',()=>{const aging=readFileSync('src/lib/reporting/aging.ts','utf8');assert.match(aging,/unappliedAmount/);assert.match(aging,/sourceType:'OVERPAYMENT'/);assert.match(aging,/sourceType:'CREDIT_NOTE'/);assert.match(aging,/sourceType:'VENDOR_CREDIT'/);assert.match(aging,/const balance=-Number\(payment\.unappliedAmount\)/)})

test('certification compares exact targets, amounts, credits, and remaining balances',()=>{const certification=readFileSync('src/lib/quickbooks-certification/payment-allocations.ts','utf8'),validation=readFileSync('src/lib/quickbooks-validation/accounting.ts','utf8');for(const field of ['source_line_key','source_target_id','creditSourceIds','unappliedAmount'])assert.match(certification,new RegExp(field));assert.match(validation,/allocations\.length!==actual\.length/);assert.match(validation,/credit relationships do not match QuickBooks/)})

test('payment ledger posting applies realized FX independently for every allocation',()=>{const posting=readFileSync('src/lib/accounting/document-posting.ts','utf8');assert.match(posting,/from\('payment_allocations'\)/);assert.match(posting,/transactionAmount:cashAmount/);assert.match(posting,/realizedLines\.length>=2/)})
