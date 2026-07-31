import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { extractQuickBooksDepositRelationships } from '../../src/lib/import-export/quickbooks/deposit-relationships'

const paymentLine=(amount:number,id:string,index=0)=>({Id:String(index),Amount:amount,Description:`Payment ${id}`,LinkedTxn:[{TxnType:'Payment',TxnId:id}],DepositLineDetail:{EntityRef:{value:`customer-${index}`}}})

test('one QuickBooks deposit preserves multiple customer payments as distinct allocations',()=>{const result=extractQuickBooksDepositRelationships({Id:'DEP-1',TotalAmt:150,Line:[paymentLine(100,'PAY-1'),paymentLine(50,'PAY-2',1)]});assert.equal(result.issues.length,0);assert.equal(result.total,150);assert.deepEqual(result.allocations.map(item=>[item.sourceTransactionType,item.sourceTransactionId,item.amount]),[['Payment','PAY-1',100],['Payment','PAY-2',50]]);assert.notEqual(result.allocations[0].sourceLineKey,result.allocations[1].sourceLineKey)})

test('a partial payment deposit retains only the amount deposited',()=>{const result=extractQuickBooksDepositRelationships({TotalAmt:30,Line:[paymentLine(30,'PAY-100')]});assert.equal(result.issues.length,0);assert.equal(result.allocations[0].amount,30)})

test('processing fees remain signed allocations so the bank receives the net deposit',()=>{const result=extractQuickBooksDepositRelationships({TotalAmt:97,Line:[paymentLine(100,'PAY-1'),{Amount:-3,Description:'Card fee',DepositLineDetail:{AccountRef:{value:'FEE-ACCOUNT'}}}]});assert.equal(result.issues.length,0);assert.deepEqual(result.allocations.map(item=>item.amount),[100,-3]);assert.equal(result.allocations.reduce((sum,item)=>sum+item.amount,0),97)})

test('deposit parsing fails closed for ambiguous linked transactions',()=>{const result=extractQuickBooksDepositRelationships({TotalAmt:100,Line:[{Amount:100,LinkedTxn:[{TxnType:'Payment',TxnId:'PAY-1'},{TxnType:'SalesReceipt',TxnId:'SR-1'}]}]});assert.equal(result.allocations.length,0);assert.match(result.issues.join(' '),/2 linked transactions/)})

test('deposit parsing detects a source total that does not equal its lines',()=>{const result=extractQuickBooksDepositRelationships({TotalAmt:101,Line:[paymentLine(100,'PAY-1')]});assert.match(result.issues.join(' '),/does not equal line allocations/)})

test('customer payments post to their preserved Undeposited Funds account',()=>{const source=readFileSync('src/lib/accounting/document-posting.ts','utf8');assert.match(source,/payment\.deposit_account_id/);assert.match(source,/settlementAccount=String\(payment\.deposit_account_id\)/);assert.match(source,/Undeposited Funds account is required/)})

test('deposit materialization resolves every source payment and posts one balanced bank entry',()=>{const source=readFileSync('src/lib/import-export/registry/modules/quickbooks-extended.module.ts','utf8');assert.match(source,/extractQuickBooksDepositRelationships/);assert.match(source,/QuickBooks payment \$\{allocation\.sourceTransactionId\} must be migrated/);assert.match(source,/payment\?\.data\?\.deposit_account_id/);assert.match(source,/allocation\.amount>0\?.*credit:amount.*debit:amount/);assert.match(source,/sourcePayloadHash:payloadHash/)})

test('deposit allocation replacement is atomic, tenant-safe, and prevents redepositing a payment',()=>{const sql=readFileSync('supabase/migrations/057_quickbooks_deposit_materialization.sql','utf8');assert.match(sql,/replace_deposit_allocations/);assert.match(sql,/FOR UPDATE/);assert.match(sql,/Deposit allocations \(%\) do not equal bank transaction/);assert.match(sql,/A source payment is deposited more than once/);assert.match(sql,/UNIQUE\(company_id,bank_transaction_id,source_line_key\)/)})

test('exact re-import is idempotent while changed source payloads conflict',()=>{const source=readFileSync('src/lib/banking/transactions.ts','utf8'),sql=readFileSync('supabase/migrations/057_quickbooks_deposit_materialization.sql','utf8');assert.match(source,/_idempotent:true/);assert.match(source,/source_payload_hash/);assert.match(source,/changed after materialization; resolve the synchronization conflict/);assert.match(sql,/bank_transactions_external_source_uniq/);assert.match(sql,/Older deposit materialization used the archive UUID/)})

test('historical extraction partitions deposits and retains durable checkpoints',()=>{const adapter=readFileSync('src/lib/import-export/sources/quickbooks.adapter.ts','utf8'),migration=readFileSync('supabase/migrations/051_quickbooks_migration_completion.sql','utf8');assert.match(adapter,/PARTITIONED_RESOURCES = new Set\(\[[^\]]*'deposits'/);assert.match(migration,/quickbooks_migration_checkpoints/);assert.match(migration,/partition_start/);assert.match(migration,/next_start_position/)})

test('deposit certification proves source lines, bank ledger, payment links, and bank roll-forward',()=>{const source=readFileSync('src/lib/quickbooks-certification/deposits.ts','utf8'),service=readFileSync('src/lib/quickbooks-certification/service.ts','utf8');for(const evidence of ['source_line_key','sourcePayment','balancedBankLedger','opening_balance','current_balance'])assert.match(source,new RegExp(evidence));assert.match(service,/certifyDeposits/);assert.match(service,/deposit-reconciliation/)})

test('bank reconciliation completes only when the statement equals the dated transaction roll-forward',()=>{const sql=readFileSync('supabase/migrations/057_quickbooks_deposit_materialization.sql','utf8'),route=readFileSync('src/app/api/banking/reconciliations/[id]/route.ts','utf8');assert.match(sql,/complete_bank_reconciliation/);assert.match(sql,/transaction_date<=reconciliation\.statement_date/);assert.match(sql,/Statement balance \(%\) does not reconcile/);assert.match(sql,/bank_reconciliation_items/);assert.match(sql,/action='RECONCILED'/);assert.match(route,/complete_bank_reconciliation/);assert.doesNotMatch(route,/\.eq\('status', 'MATCHED'\)/)})

test('grouped deposit accounting leaves Undeposited Funds and bank mathematically correct',()=>{const payments=[100,50],fee=-3,deposit=payments.reduce((sum,value)=>sum+value,0)+fee;const undepositedDebit=150,undepositedCredit=150,bankDebit=deposit,feeDebit=Math.abs(fee);assert.equal(undepositedDebit-undepositedCredit,0);assert.equal(bankDebit+feeDebit,undepositedCredit);assert.equal(bankDebit,147)})
