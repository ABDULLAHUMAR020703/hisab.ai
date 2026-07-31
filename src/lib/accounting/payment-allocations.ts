import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveQuickBooksLocalId } from '@/lib/import-export/quickbooks/migration-store'
import type { QuickBooksPaymentAllocation,QuickBooksPaymentKind } from '@/lib/import-export/quickbooks/payment-relationships'

export interface PaymentAllocationInput {
  invoiceId?:string|null
  billId?:string|null
  amount:number
  cashAmount?:number
  creditAmount?:number
  currency:string
  exchangeRate?:number|null
  sourceSystem?:string
  sourcePaymentId?:string|null
  sourceLineKey:string
  sourceTargetId?:string|null
  sourceCreditIds?:string[]
  localCreditIds?:string[]
  metadata?:Record<string,unknown>
}

export async function replacePaymentAllocations(companyId:string,paymentId:string,allocations:PaymentAllocationInput[]) {
  for(const allocation of allocations)if((allocation.creditAmount??0)>0&&(allocation.localCreditIds?.length??0)!==1)throw new Error(`${allocation.sourceLineKey} must resolve exactly one local credit document.`)
  const payload=allocations.map(item=>({invoice_id:item.invoiceId??null,bill_id:item.billId??null,amount:item.amount,cash_amount:item.cashAmount??item.amount,credit_amount:item.creditAmount??0,currency:item.currency,exchange_rate:item.exchangeRate??null,source_system:item.sourceSystem??'HISAB',source_payment_id:item.sourcePaymentId??null,source_line_key:item.sourceLineKey,source_target_id:item.sourceTargetId??null,source_credit_ids:item.sourceCreditIds??[],local_credit_ids:item.localCreditIds??[],metadata:item.metadata??{}}))
  const {error}=await createAdminClient().rpc('replace_payment_allocations',{p_company_id:companyId,p_payment_id:paymentId,p_allocations:payload})
  if(error)throw new Error(error.message)
}

export async function resolveQuickBooksPaymentAllocations(input:{companyId:string;realmId:string;sourcePaymentId:string;kind:QuickBooksPaymentKind;currency:string;exchangeRate:number;allocations:QuickBooksPaymentAllocation[]}) {
  const output:PaymentAllocationInput[]=[]
  for(const allocation of input.allocations){
    const target=await resolveQuickBooksLocalId(input.companyId,input.realmId,allocation.targetSourceId,[allocation.targetType],[allocation.targetType==='Invoice'?'invoices':'bills'])
    if(!target)throw new Error(`QuickBooks ${allocation.targetType} ${allocation.targetSourceId} must be migrated before payment ${input.sourcePaymentId}.`)
    const localCreditIds:string[]=[]
    for(const sourceCreditId of allocation.creditSourceIds){const credit=await resolveQuickBooksLocalId(input.companyId,input.realmId,sourceCreditId,[input.kind==='CUSTOMER'?'CreditMemo':'VendorCredit'],[input.kind==='CUSTOMER'?'invoices':'vendor_credits']);if(!credit)throw new Error(`QuickBooks credit ${sourceCreditId} must be migrated before payment ${input.sourcePaymentId}.`);localCreditIds.push(credit.id)}
    output.push({invoiceId:allocation.targetType==='Invoice'?target.id:null,billId:allocation.targetType==='Bill'?target.id:null,amount:allocation.amount,cashAmount:allocation.cashAmount,creditAmount:allocation.creditAmount,currency:input.currency,exchangeRate:input.exchangeRate,sourceSystem:'QUICKBOOKS',sourcePaymentId:input.sourcePaymentId,sourceLineKey:allocation.sourceLineKey,sourceTargetId:allocation.targetSourceId,sourceCreditIds:allocation.creditSourceIds,localCreditIds,metadata:{linkedTransactions:allocation.linkedTransactions}})
  }
  return output
}
