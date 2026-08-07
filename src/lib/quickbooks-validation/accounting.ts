import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { extractQuickBooksPaymentRelationships } from '@/lib/import-export/quickbooks/payment-relationships'
import { extractQuickBooksDepositRelationships } from '@/lib/import-export/quickbooks/deposit-relationships'

export interface AccountingMaterializationIssue { sourceId:string; moduleKey:string; localId:string; kind:'posting'|'balance'|'inventory'|'tax'|'relationship'|'allocation'|'deposit'|'reconciliation'; message:string }
export interface AccountingMaterializationValidation { passed:boolean; completed:number; failed:number; conflicts:number; manualRequired:number; balancedLedgers:number; inventoryDocuments:number; issues:AccountingMaterializationIssue[] }

const LEDGER_SOURCE:Record<string,string>={invoices:'INVOICE',bills:'BILL',expenses:'EXPENSE','customer-payments':'PAYMENT','vendor-payments':'PAYMENT','journal-entries':'JOURNAL','sales-receipts':'SALES_RECEIPT','vendor-credits':'SUPPLIER_CREDIT','qb-credit-memos':'INVOICE','qb-deposits':'DEPOSIT','qb-transfers':'BANK_TRANSFER',payroll:'PAYROLL'}

export async function validateQuickBooksAccountingMaterialization(companyId:string):Promise<AccountingMaterializationValidation> {
  const db=createAdminClient(); const runs=await db.from('quickbooks_materialization_runs').select('*').eq('company_id',companyId)
  if(runs.error) throw runs.error
  const issues:AccountingMaterializationIssue[]=[]; let balancedLedgers=0; let inventoryDocuments=0
  for(const run of runs.data??[]) {
    const base={sourceId:String(run.source_id),moduleKey:String(run.module_key),localId:String(run.local_id)}
    if(run.status==='failed') issues.push({...base,kind:'posting',message:String(run.last_error??'Native posting failed')})
    if(run.status==='conflict') issues.push({...base,kind:'posting',message:String(run.last_error??'Posted document changed at source')})
    if(run.status!=='completed') continue
    const sourceType=LEDGER_SOURCE[String(run.module_key)]
    if(sourceType) {
      let ledgerQuery=db.from('ledger_entries').select('base_debit,base_credit,debit,credit,cost_center_id,account:chart_of_accounts(name)').eq('company_id',companyId).eq('source_id',run.local_id)
      if(String(run.module_key)!=='sales-receipts')ledgerQuery=ledgerQuery.eq('source_type',sourceType)
      const ledger=await ledgerQuery
      if(ledger.error) throw ledger.error
      const debit=(ledger.data??[]).reduce((sum,line)=>sum+Number(line.base_debit??line.debit??0),0); const credit=(ledger.data??[]).reduce((sum,line)=>sum+Number(line.base_credit??line.credit??0),0)
      let creditOnlyApplication=false;if(['customer-payments','vendor-payments'].includes(String(run.module_key))&&!ledger.data?.length){const [payment,allocations]=await Promise.all([db.from('payments').select('amount').eq('company_id',companyId).eq('id',run.local_id).maybeSingle(),db.from('payment_allocations').select('credit_amount').eq('company_id',companyId).eq('payment_id',run.local_id)]);if(payment.error)throw payment.error;if(allocations.error)throw allocations.error;creditOnlyApplication=Number(payment.data?.amount)===0&&(allocations.data??[]).reduce((sum,item)=>sum+Number(item.credit_amount),0)>0}
      if((ledger.data?.length&&Math.abs(debit-credit)<=0.01)||creditOnlyApplication) balancedLedgers++
      else issues.push({...base,kind:'balance',message:`Ledger is not balanced (${debit.toFixed(4)} debit, ${credit.toFixed(4)} credit).`})
      const archive=await db.from('quickbooks_migration_records').select('source_payload').eq('company_id',companyId).eq('entity_type',run.entity_type).eq('source_id',run.source_id).maybeSingle()
      if(archive.error) throw archive.error
      const serialized=JSON.stringify(archive.data?.source_payload??{})
      if(serialized.includes('ClassRef')&&!(ledger.data??[]).some(line=>line.cost_center_id)) issues.push({...base,kind:'allocation',message:'QuickBooks class/project allocation did not reach the ledger.'})
      const payload=(archive.data?.source_payload??{}) as Record<string,unknown>; const taxDetail=(payload.TxnTaxDetail??{}) as Record<string,unknown>; const sourceTax=Number(taxDetail.TotalTax??0)
      if(sourceTax>0&&!serialized.toLowerCase().includes('taxexempt')) {
        const hasTax=(ledger.data??[]).some(line=>JSON.stringify(line.account).toLowerCase().includes('vat')||JSON.stringify(line.account).toLowerCase().includes('tax'))
        if(!hasTax) issues.push({...base,kind:'tax',message:'Tax-bearing source document has no tax ledger line.'})
      }
    }
    if(['invoices','bills','sales-receipts','vendor-credits'].includes(String(run.module_key))) {
      const movements=await db.from('stock_movements').select('id').eq('company_id',companyId).eq('source_type',sourceType).eq('source_id',run.local_id)
      if(movements.error) throw movements.error
      if(movements.data?.length) inventoryDocuments++
    }
    if(['customer-payments','vendor-payments'].includes(String(run.module_key))) {
      const payment=await db.from('payments').select('invoice_id,bill_id,amount,applied_amount,credit_applied_amount,unapplied_amount').eq('company_id',companyId).eq('id',run.local_id).maybeSingle()
      if(payment.error) throw payment.error
      if(!payment.data?.invoice_id&&!payment.data?.bill_id) issues.push({...base,kind:'relationship',message:'Payment is not linked to an invoice or bill.'})
      const [archive,allocationResult]=await Promise.all([db.from('quickbooks_migration_records').select('source_payload').eq('company_id',companyId).eq('entity_type',run.entity_type).eq('source_id',run.source_id).maybeSingle(),db.from('payment_allocations').select('source_line_key,source_target_id,source_credit_ids,amount,cash_amount,credit_amount').eq('company_id',companyId).eq('payment_id',run.local_id).eq('source_system','QUICKBOOKS')])
      if(archive.error)throw archive.error;if(allocationResult.error)throw allocationResult.error
      const expected=extractQuickBooksPaymentRelationships((archive.data?.source_payload??{}) as Record<string,unknown>,String(run.entity_type)==='BillPayment'?'VENDOR':'CUSTOMER'),actual=allocationResult.data??[]
      for(const message of expected.issues)issues.push({...base,kind:'relationship',message})
      if(expected.allocations.length!==actual.length)issues.push({...base,kind:'allocation',message:`QuickBooks has ${expected.allocations.length} allocations; Hisab has ${actual.length}.`})
      const actualByKey=new Map(actual.map(item=>[`${item.source_line_key}:${item.source_target_id}`,item]))
      for(const allocation of expected.allocations){const match=actualByKey.get(`${allocation.sourceLineKey}:${allocation.targetSourceId}`);if(!match){issues.push({...base,kind:'allocation',message:`Missing allocation to ${allocation.targetType} ${allocation.targetSourceId}.`});continue}const sourceCredits=[...allocation.creditSourceIds].sort(),localCredits=Array.isArray(match.source_credit_ids)?match.source_credit_ids.map(String).sort():[];if(Math.abs(Number(match.amount)-allocation.amount)>0.0001||Math.abs(Number(match.cash_amount)-allocation.cashAmount)>0.0001||Math.abs(Number(match.credit_amount)-allocation.creditAmount)>0.0001)issues.push({...base,kind:'allocation',message:`Allocation ${allocation.sourceLineKey} amounts do not match QuickBooks.`});if(JSON.stringify(sourceCredits)!==JSON.stringify(localCredits))issues.push({...base,kind:'relationship',message:`Allocation ${allocation.sourceLineKey} credit relationships do not match QuickBooks.`})}
      if(payment.data&&(Math.abs(Number(payment.data.amount)-expected.paymentAmount)>0.0001||Math.abs(Number(payment.data.applied_amount)-expected.appliedAmount)>0.0001||Math.abs(Number(payment.data.credit_applied_amount)-expected.creditAppliedAmount)>0.0001||Math.abs(Number(payment.data.unapplied_amount)-expected.unappliedAmount)>0.0001))issues.push({...base,kind:'allocation',message:'Payment applied, credit, or remaining amount does not match QuickBooks.'})
    }
    if(String(run.module_key)==='vendor-credits'){
      const [credit,lines,applications]=await Promise.all([db.from('vendor_credits').select('total,tax_amount,applied_amount,balance,ap_account_id').eq('company_id',companyId).eq('id',run.local_id).maybeSingle(),db.from('vendor_credit_lines').select('amount,inventory_item_id,detail_type').eq('company_id',companyId).eq('vendor_credit_id',run.local_id),db.from('vendor_credit_applications').select('amount').eq('company_id',companyId).eq('vendor_credit_id',run.local_id)]);if(credit.error)throw credit.error;if(lines.error)throw lines.error;if(applications.error)throw applications.error
      const lineTotal=(lines.data??[]).filter(line=>['AccountBasedExpenseLineDetail','ItemBasedExpenseLineDetail','PurchaseItemLineDetail'].includes(String(line.detail_type))).reduce((sum,line)=>sum+Number(line.amount),0),applied=(applications.data??[]).reduce((sum,item)=>sum+Number(item.amount),0);if(!credit.data||Math.abs(lineTotal+Number(credit.data.tax_amount)-Number(credit.data.total))>0.01)issues.push({...base,kind:'balance',message:'Vendor Credit lines and tax do not equal its document total.'});if(credit.data&&(Math.abs(applied-Number(credit.data.applied_amount))>0.0001||Math.abs(Number(credit.data.total)-applied-Number(credit.data.balance))>0.0001))issues.push({...base,kind:'allocation',message:'Vendor Credit applications and remaining balance do not reconcile.'})
    }
  }
  const depositRecords=await db.from('quickbooks_migration_records').select('source_id,source_payload').eq('company_id',companyId).eq('entity_type','Deposit').eq('is_deleted',false)
  if(depositRecords.error)throw depositRecords.error
  for(const record of depositRecords.data??[]){const sourceId=String(record.source_id),expected=extractQuickBooksDepositRelationships((record.source_payload??{}) as Record<string,unknown>),transaction=await db.from('bank_transactions').select('id,amount,bank_account_id').eq('company_id',companyId).eq('source_type','QUICKBOOKS_DEPOSIT').eq('source_id',sourceId).maybeSingle();if(transaction.error)throw transaction.error;const base={sourceId,moduleKey:'qb-deposits',localId:String(transaction.data?.id??'')};for(const message of expected.issues)issues.push({...base,kind:'relationship',message});if(!transaction.data){issues.push({...base,kind:'deposit',message:'QuickBooks deposit has not been materialized.'});continue}
    const [actual,bank,ledger]=await Promise.all([db.from('deposit_allocations').select('source_line_key,source_transaction_type,source_transaction_id,source_account_id,payment_id,account_id,amount').eq('company_id',companyId).eq('bank_transaction_id',transaction.data.id),db.from('bank_accounts').select('account_id').eq('company_id',companyId).eq('id',transaction.data.bank_account_id).maybeSingle(),db.from('ledger_entries').select('account_id,debit,credit').eq('company_id',companyId).eq('source_type','DEPOSIT').eq('source_id',transaction.data.id)])
    if(actual.error)throw actual.error;if(bank.error)throw bank.error;if(ledger.error)throw ledger.error;const local=actual.data??[],byLine=new Map(local.map(item=>[String(item.source_line_key),item]));if(local.length!==expected.allocations.length)issues.push({...base,kind:'allocation',message:`QuickBooks has ${expected.allocations.length} deposit allocations; Hisab has ${local.length}.`});for(const item of expected.allocations){const match=byLine.get(item.sourceLineKey);if(!match){issues.push({...base,kind:'allocation',message:`Missing deposit allocation ${item.sourceLineKey}.`});continue}if(Math.abs(Number(match.amount)-item.amount)>0.0001||String(match.source_transaction_id??'')!==String(item.sourceTransactionId??'')||String(match.source_account_id??'')!==String(item.sourceAccountId??''))issues.push({...base,kind:'allocation',message:`Deposit allocation ${item.sourceLineKey} does not exactly match QuickBooks.`});if(item.sourceTransactionType.toLowerCase()==='payment'&&!match.payment_id)issues.push({...base,kind:'relationship',message:`Deposit allocation ${item.sourceLineKey} lost its source payment.`})}
    const debit=(ledger.data??[]).reduce((sum,line)=>sum+Number(line.debit??0),0),credit=(ledger.data??[]).reduce((sum,line)=>sum+Number(line.credit??0),0),bankDebit=(ledger.data??[]).filter(line=>String(line.account_id)===String(bank.data?.account_id??'')).reduce((sum,line)=>sum+Number(line.debit??0),0);if(Math.abs(debit-credit)>0.0001||Math.abs(bankDebit-expected.total)>0.0001)issues.push({...base,kind:'balance',message:`Deposit ledger does not reconcile: ${debit.toFixed(4)} debit, ${credit.toFixed(4)} credit, ${bankDebit.toFixed(4)} bank debit.`})
  }
  const banks=await db.from('bank_accounts').select('id,name,opening_balance,current_balance').eq('company_id',companyId).is('deleted_at',null);if(banks.error)throw banks.error
  for(const bank of banks.data??[]){const transactions=await db.from('bank_transactions').select('type,amount').eq('company_id',companyId).eq('bank_account_id',bank.id);if(transactions.error)throw transactions.error;const calculated=Number(bank.opening_balance)+(transactions.data??[]).reduce((sum,item)=>sum+(String(item.type)==='CREDIT'?Number(item.amount):-Number(item.amount)),0);if(Math.abs(calculated-Number(bank.current_balance))>0.0001)issues.push({sourceId:String(bank.id),moduleKey:'bank-reconciliation',localId:String(bank.id),kind:'reconciliation',message:`${bank.name} current balance does not equal opening balance plus transaction history.`})}
  const rows=runs.data??[]
  return {passed:issues.length===0&&rows.every(run=>run.status==='completed'),completed:rows.filter(run=>run.status==='completed').length,failed:rows.filter(run=>run.status==='failed').length,conflicts:rows.filter(run=>run.status==='conflict').length,manualRequired:rows.filter(run=>run.status==='manual_required').length,balancedLedgers,inventoryDocuments,issues}
}
