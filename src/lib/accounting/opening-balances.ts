import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { getNextSequence } from '@/lib/sequences'
import { postJournalEntry } from './posting-service'
import { openingSubledgerDocumentType,openingSubledgerKey,type OpeningSubledgerKind } from './opening-subledger-engine'

export interface OpeningBalanceLine { accountId:string; debit:number; credit:number; description?:string }
export interface OpeningSubledgerBalance {
  kind:OpeningSubledgerKind;sourceKey:string;partyId:string;partyName:string;amount:number
}

async function existingByLegacy(table:string,companyId:string,legacyId:string){
  const result=await createAdminClient().from(table).select('id').eq('company_id',companyId).eq('legacy_id',legacyId).maybeSingle()
  if(result.error)throw result.error
  return result.data?.id?String(result.data.id):null
}

/**
 * Materializes opening receivables/payables into the same native documents used
 * by aging and statement reports. These documents intentionally do not post to
 * the ledger: the balanced cutoff journal already contains the AR/AP control
 * account opening and posting the subledger document would duplicate it.
 */
export async function materializeOpeningSubledgerBalances(input:{
  companyId:string;userId:string;reconciliationId:string;date:Date;currency:string;balances:OpeningSubledgerBalance[]
}){
  const db=createAdminClient(),prefix=`quickbooks-cutoff:${input.reconciliationId}:%`
  for(const table of ['invoices','bills','payments','vendor_credits']){
    const cleared=await db.from(table).update({deleted_at:new Date().toISOString()}).eq('company_id',input.companyId).like('legacy_id',prefix)
    if(cleared.error)throw cleared.error
  }
  const ids:{invoices:string[];bills:string[];payments:string[];vendorCredits:string[]}={invoices:[],bills:[],payments:[],vendorCredits:[]}
  for(const item of input.balances){
    if(Math.abs(item.amount)<0.000001)continue
    const legacyId=openingSubledgerKey(input.reconciliationId,item.kind,item.sourceKey),amount=Math.abs(item.amount),description=`QuickBooks opening balance: ${item.partyName}`,documentType=openingSubledgerDocumentType(item.kind,item.amount)
    if(documentType==='INVOICE'){
      const values={company_id:input.companyId,legacy_id:legacyId,invoice_no:`OB-AR-${legacyId.slice(-12)}`,invoice_type:'STANDARD',customer_id:item.partyId,date:input.date.toISOString(),due_date:input.date.toISOString(),currency:input.currency,status:'SENT',subtotal:amount,tax_amount:0,total:amount,amount_paid:0,balance:amount,notes:description,created_by_id:input.userId,deleted_at:null}
      const prior=await existingByLegacy('invoices',input.companyId,legacyId),result=prior?await db.from('invoices').update(values).eq('company_id',input.companyId).eq('id',prior).select('id').single():await db.from('invoices').insert(values).select('id').single();if(result.error)throw result.error
      const id=String(result.data.id);ids.invoices.push(id);const removed=await db.from('invoice_lines').delete().eq('company_id',input.companyId).eq('invoice_id',id);if(removed.error)throw removed.error
      const line=await db.from('invoice_lines').insert({company_id:input.companyId,legacy_id:`${legacyId}:line`,invoice_id:id,description,quantity:1,unit_price:amount,tax_rate:0,amount});if(line.error)throw line.error
    }else if(documentType==='BILL'){
      const values={company_id:input.companyId,legacy_id:legacyId,bill_no:`OB-AP-${legacyId.slice(-12)}`,vendor_id:item.partyId,date:input.date.toISOString(),due_date:input.date.toISOString(),currency:input.currency,status:'RECEIVED',subtotal:amount,tax_amount:0,total:amount,amount_paid:0,balance:amount,notes:description,reference:'QUICKBOOKS_CUTOFF_OPENING',created_by_id:input.userId,deleted_at:null}
      const prior=await existingByLegacy('bills',input.companyId,legacyId),result=prior?await db.from('bills').update(values).eq('company_id',input.companyId).eq('id',prior).select('id').single():await db.from('bills').insert(values).select('id').single();if(result.error)throw result.error
      const id=String(result.data.id);ids.bills.push(id);const removed=await db.from('bill_lines').delete().eq('company_id',input.companyId).eq('bill_id',id);if(removed.error)throw removed.error
      const line=await db.from('bill_lines').insert({company_id:input.companyId,legacy_id:`${legacyId}:line`,bill_id:id,description,quantity:1,unit_price:amount,tax_rate:0,amount});if(line.error)throw line.error
    }else if(documentType==='CUSTOMER_CREDIT'){
      const values={company_id:input.companyId,legacy_id:legacyId,payment_no:`OB-ARCR-${legacyId.slice(-12)}`,date:input.date.toISOString(),amount,method:'OTHER',reference:'QUICKBOOKS_CUTOFF_OPENING',notes:description,customer_id:item.partyId,applied_amount:0,credit_applied_amount:0,unapplied_amount:amount,currency:input.currency,deleted_at:null}
      const prior=await existingByLegacy('payments',input.companyId,legacyId),result=prior?await db.from('payments').update(values).eq('company_id',input.companyId).eq('id',prior).select('id').single():await db.from('payments').insert(values).select('id').single();if(result.error)throw result.error;ids.payments.push(String(result.data.id))
    }else{
      const values={company_id:input.companyId,legacy_id:legacyId,credit_no:`OB-APCR-${legacyId.slice(-12)}`,vendor_id:item.partyId,date:input.date.toISOString(),status:'OPEN',currency:input.currency,subtotal:amount,tax_amount:0,total:amount,applied_amount:0,balance:amount,notes:description,reference:'QUICKBOOKS_CUTOFF_OPENING',deleted_at:null}
      const prior=await existingByLegacy('vendor_credits',input.companyId,legacyId),result=prior?await db.from('vendor_credits').update(values).eq('company_id',input.companyId).eq('id',prior).select('id').single():await db.from('vendor_credits').insert(values).select('id').single();if(result.error)throw result.error;ids.vendorCredits.push(String(result.data.id))
    }
  }
  return ids
}

export async function postIdempotentOpeningBalance(input:{
  companyId:string;userId:string;date:Date;currency:string;description:string;idempotencyKey:string;lines:OpeningBalanceLine[]
}){
  const db=createAdminClient();const legacyId=`quickbooks-cutoff:${input.idempotencyKey}`
  const lines=input.lines.filter(line=>line.debit>0||line.credit>0)
  if(lines.length<2)throw new Error('At least two non-zero opening balance lines are required.')
  const debit=lines.reduce((sum,line)=>sum+line.debit,0),credit=lines.reduce((sum,line)=>sum+line.credit,0)
  if(Math.abs(debit-credit)>0.000001)throw new Error(`Opening balance is not balanced (debit ${debit}, credit ${credit}).`)
  const existing=await db.from('journal_entries').select('id,status,posting_sequence').eq('company_id',input.companyId).eq('legacy_id',legacyId).is('deleted_at',null).maybeSingle()
  if(existing.error)throw existing.error
  if(existing.data?.status==='POSTED'){
    const current=await db.from('journal_lines').select('account_id,debit,credit').eq('company_id',input.companyId).eq('journal_id',existing.data.id);if(current.error)throw current.error
    const signature=(values:Array<{accountId:string;debit:number;credit:number}>)=>values.map(line=>`${line.accountId}:${Number(line.debit).toFixed(6)}:${Number(line.credit).toFixed(6)}`).sort().join('|')
    const actual=(current.data??[]).map(line=>({accountId:String(line.account_id),debit:Number(line.debit),credit:Number(line.credit)}))
    if(signature(actual)!==signature(lines))throw new Error('The QuickBooks opening snapshot changed after its journal was posted. Reverse the prior opening journal before retrying with the changed source data.')
    return {journalId:String(existing.data.id),postingSequence:Number(existing.data.posting_sequence??0),reused:true}
  }
  let journalId:string
  if(existing.data){
    journalId=String(existing.data.id)
    const removed=await db.from('journal_lines').delete().eq('company_id',input.companyId).eq('journal_id',journalId);if(removed.error)throw removed.error
    const updated=await db.from('journal_entries').update({date:input.date.toISOString(),description:input.description,total_debit:debit,total_credit:credit,currency:input.currency,status:'DRAFT',entry_type:'OPENING'}).eq('company_id',input.companyId).eq('id',journalId);if(updated.error)throw updated.error
  }else{
    const entryNo=await getNextSequence('JOURNAL','OB-')
    const inserted=await db.from('journal_entries').insert({company_id:input.companyId,legacy_id:legacyId,entry_no:entryNo,date:input.date.toISOString(),description:input.description,reference:'QUICKBOOKS_CUTOFF_OPENING',status:'DRAFT',total_debit:debit,total_credit:credit,created_by_id:input.userId,entry_type:'OPENING',post_reason:'QuickBooks historical cutoff opening balance',currency:input.currency}).select('id').single()
    if(inserted.error)throw inserted.error;journalId=String(inserted.data.id)
  }
  const insertedLines=await db.from('journal_lines').insert(lines.map((line,index)=>({company_id:input.companyId,journal_id:journalId,legacy_id:`${legacyId}:${index}`,account_id:line.accountId,description:line.description??input.description,debit:line.debit,credit:line.credit})))
  if(insertedLines.error)throw insertedLines.error
  const postingSequence=await postJournalEntry(journalId,{companyId:input.companyId,userId:input.userId,reason:'QuickBooks historical cutoff opening balance'})
  return {journalId,postingSequence,reused:false}
}
