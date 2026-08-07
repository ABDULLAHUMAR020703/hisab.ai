import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { extractQuickBooksDepositRelationships } from '@/lib/import-export/quickbooks/deposit-relationships'
import { compareFxRows,type FxComparableRow } from './multicurrency-engine'
import type { CertificationDifference,CertificationParameters,CertificationSection } from './types'

type Row=Record<string,unknown>
const object=(value:unknown):Row=>value&&typeof value==='object'?value as Row:{}
const number=(value:unknown)=>Number.isFinite(Number(value))?Number(value):0
const round=(value:number)=>Math.round(value*10_000)/10_000
// Supabase's generated types intentionally do not cover migration-owned dynamic tables.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function pages(table:string,build:(query:any)=>any){const db=createAdminClient(),rows:Row[]=[];for(let from=0;;from+=1000){const result=await build(db.from(table).select('*')).range(from,from+999);if(result.error)throw result.error;rows.push(...((result.data??[]) as Row[]));if((result.data?.length??0)<1000)break}return rows}

export async function certifyDeposits(companyId:string,realmId:string,parameters:CertificationParameters):Promise<CertificationSection>{
  const [records,transactions,allocations,payments,banks,allBankTransactions,ledger]=await Promise.all([
    pages('quickbooks_migration_records',q=>q.eq('company_id',companyId).eq('realm_id',realmId).eq('entity_type','Deposit').eq('is_deleted',false)),
    pages('bank_transactions',q=>q.eq('company_id',companyId).eq('source_type','QUICKBOOKS_DEPOSIT')),
    pages('deposit_allocations',q=>q.eq('company_id',companyId)),pages('payments',q=>q.eq('company_id',companyId).is('deleted_at',null)),
    pages('bank_accounts',q=>q.eq('company_id',companyId).is('deleted_at',null)),pages('bank_transactions',q=>q.eq('company_id',companyId)),
    pages('ledger_entries',q=>q.eq('company_id',companyId).eq('source_type','DEPOSIT')),
  ])
  const source:FxComparableRow[]=[],local:FxComparableRow[]=[],failures:CertificationDifference[]=[],transactionBySource=new Map(transactions.map(item=>[String(item.source_id),item])),paymentById=new Map(payments.map(item=>[String(item.id),item])),allocationsByTransaction=new Map<string,Row[]>()
  for(const item of allocations){const key=String(item.bank_transaction_id),list=allocationsByTransaction.get(key)??[];list.push(item);allocationsByTransaction.set(key,list)}
  for(const record of records){const sourceId=String(record.source_id),relationships=extractQuickBooksDepositRelationships(object(record.source_payload)),transaction=transactionBySource.get(sourceId),localAllocations=transaction?allocationsByTransaction.get(String(transaction.id))??[]:[],localByLine=new Map(localAllocations.map(item=>[String(item.source_line_key),item])),currency=String(record.currency_code??parameters.homeCurrency).toUpperCase()
    source.push({key:`Deposit:${sourceId}:summary`,label:`Deposit ${sourceId} summary`,currency,sourceId,values:{amount:relationships.total,allocations:relationships.allocations.length}})
    if(transaction)local.push({key:`Deposit:${sourceId}:summary`,label:`Deposit ${sourceId} summary`,currency,localId:String(transaction.id),values:{amount:number(transaction.amount),allocations:localAllocations.length}})
    for(const issue of relationships.issues)failures.push({reportKey:'deposit-reconciliation',key:`Deposit:${sourceId}:evidence`,label:`Deposit ${sourceId}`,metric:'relationshipEvidence',quickBooksValue:1,hisabValue:0,difference:-1,materiality:0,severity:'ERROR',recommendedAction:issue,sourceRefs:[{sourceId,documentId:transaction?String(transaction.id):undefined}]})
    for(const expected of relationships.allocations){const key=`Deposit:${sourceId}:${expected.sourceLineKey}`,actual=localByLine.get(expected.sourceLineKey);source.push({key,label:`Deposit ${sourceId} line ${expected.sourceLineKey}`,currency,sourceId,values:{amount:expected.amount,paymentLink:expected.sourceTransactionType.toLowerCase()==='payment'?1:0}});if(actual)local.push({key,label:`Deposit ${sourceId} line ${expected.sourceLineKey}`,currency:String(actual.currency??currency),localId:String(transaction?.id??''),values:{amount:number(actual.amount),paymentLink:actual.payment_id?1:0}})
      if(expected.sourceTransactionType.toLowerCase()==='payment'&&actual?.payment_id){const payment=paymentById.get(String(actual.payment_id));if(String(payment?.legacy_id??'')!==String(expected.sourceTransactionId??''))failures.push({reportKey:'deposit-reconciliation',key,label:`Deposit ${sourceId} source payment`,metric:'sourcePayment',quickBooksValue:1,hisabValue:0,difference:-1,materiality:0,severity:'ERROR',recommendedAction:`Expected QuickBooks payment ${expected.sourceTransactionId}; the preserved Hisab payment link does not match.`,sourceRefs:[{sourceId,documentId:String(actual.payment_id)}]})}
    }
  }
  const ledgerByTransaction=new Map<string,Row[]>();for(const item of ledger){const key=String(item.source_id),list=ledgerByTransaction.get(key)??[];list.push(item);ledgerByTransaction.set(key,list)}
  const bankById=new Map(banks.map(item=>[String(item.id),item]))
  for(const transaction of transactions){const lines=ledgerByTransaction.get(String(transaction.id))??[],bank=bankById.get(String(transaction.bank_account_id)),bankAccountId=String(bank?.account_id??''),bankDebit=round(lines.filter(line=>String(line.account_id)===bankAccountId).reduce((sum,line)=>sum+number(line.debit),0)),totalDebit=round(lines.reduce((sum,line)=>sum+number(line.debit),0)),totalCredit=round(lines.reduce((sum,line)=>sum+number(line.credit),0)),amount=round(number(transaction.amount));if(bankDebit!==amount||Math.abs(totalDebit-totalCredit)>0.0001)failures.push({reportKey:'deposit-reconciliation',key:`Deposit:${transaction.source_id}:ledger`,label:`Deposit ${transaction.source_id} bank posting`,metric:'balancedBankLedger',quickBooksValue:amount,hisabValue:bankDebit,difference:bankDebit-amount,materiality:parameters.absoluteTolerance,severity:'ERROR',recommendedAction:`Regenerate the deposit ledger. Debit ${totalDebit.toFixed(4)}, credit ${totalCredit.toFixed(4)}, bank debit ${bankDebit.toFixed(4)}.`,sourceRefs:[{sourceId:String(transaction.source_id),documentId:String(transaction.id)}]})}
  const txByBank=new Map<string,Row[]>();for(const item of allBankTransactions){const key=String(item.bank_account_id),list=txByBank.get(key)??[];list.push(item);txByBank.set(key,list)}
  for(const bank of banks){const calculated=round(number(bank.opening_balance)+(txByBank.get(String(bank.id))??[]).reduce((sum,item)=>sum+(String(item.type)==='CREDIT'?number(item.amount):-number(item.amount)),0)),stored=round(number(bank.current_balance));if(Math.abs(calculated-stored)>0.0001)failures.push({reportKey:'deposit-reconciliation',key:`Bank:${bank.id}:roll-forward`,label:`${bank.name} bank roll-forward`,metric:'currentBalance',quickBooksValue:calculated,hisabValue:stored,difference:stored-calculated,materiality:parameters.absoluteTolerance,severity:'ERROR',recommendedAction:'Rebuild the bank-account balance from its opening balance and immutable transaction history.',sourceRefs:[{documentId:String(bank.id)}]})}
  const section=compareFxRows('deposit-reconciliation','Deposits, Undeposited Funds, and bank reconciliation',source,local,parameters)
  section.differences.push(...failures);if(failures.length)section.status='FAILED';section.comparedRows+=failures.length;section.maximumDifference=section.differences.reduce((max,item)=>Math.max(max,Math.abs(item.difference)),section.maximumDifference);return section
}
