import 'server-only'
import { postSourceDocumentToLedger } from '@/lib/accounting/posting-service'
import { createAdminClient } from '@/lib/supabase/admin'

export async function createBankTransfer(input:{ companyId:string; userId?:string|null; transferNo:string; fromAccountId:string; toAccountId:string; date:Date; amount:number; reference?:string|null }) {
  if(input.fromAccountId===input.toAccountId) throw new Error('Source and destination accounts must differ')
  if(!Number.isFinite(input.amount)||input.amount<=0) throw new Error('amount must be positive')
  const db=createAdminClient()
  const accounts=await db.from('bank_accounts').select('id,current_balance,name,account_id,currency').eq('company_id',input.companyId).in('id',[input.fromAccountId,input.toAccountId]).is('deleted_at',null)
  if(accounts.error) throw accounts.error
  const from=accounts.data?.find(account=>account.id===input.fromAccountId); const to=accounts.data?.find(account=>account.id===input.toAccountId)
  if(!from||!to) throw new Error('Bank account not found')
  if(Number(from.current_balance)<input.amount) throw new Error('Insufficient balance in source account')
  const existing=await db.from('bank_transfers').select('id').eq('company_id',input.companyId).eq('transfer_no',input.transferNo).maybeSingle()
  if(existing.error) throw existing.error
  let transferId=existing.data?.id?String(existing.data.id):''
  if(!transferId) {
    const created=await db.from('bank_transfers').insert({company_id:input.companyId,transfer_no:input.transferNo,from_account_id:input.fromAccountId,to_account_id:input.toAccountId,date:input.date.toISOString(),amount:input.amount,reference:input.reference??null}).select('id').single()
    if(created.error) throw created.error
    transferId=String(created.data.id)
    const fromUpdate=await db.from('bank_accounts').update({current_balance:Number(from.current_balance)-input.amount,updated_at:new Date().toISOString()}).eq('company_id',input.companyId).eq('id',input.fromAccountId)
    if(fromUpdate.error) throw fromUpdate.error
    const toUpdate=await db.from('bank_accounts').update({current_balance:Number(to.current_balance)+input.amount,updated_at:new Date().toISOString()}).eq('company_id',input.companyId).eq('id',input.toAccountId)
    if(toUpdate.error) throw toUpdate.error
    const bankRows=await db.from('bank_transactions').insert([{company_id:input.companyId,bank_account_id:input.fromAccountId,transaction_date:input.date.toISOString(),description:`Transfer to ${to.name} (${input.transferNo})`,reference:input.reference??input.transferNo,amount:input.amount,type:'DEBIT',status:'MATCHED',source_type:'BANK_TRANSFER',source_id:transferId},{company_id:input.companyId,bank_account_id:input.toAccountId,transaction_date:input.date.toISOString(),description:`Transfer from ${from.name} (${input.transferNo})`,reference:input.reference??input.transferNo,amount:input.amount,type:'CREDIT',status:'MATCHED',source_type:'BANK_TRANSFER',source_id:transferId}])
    if(bankRows.error) throw bankRows.error
  }
  if(from.account_id&&to.account_id) await postSourceDocumentToLedger({companyId:input.companyId,sourceType:'BANK_TRANSFER',sourceId:transferId,entryDate:input.date,description:`Bank transfer ${input.transferNo}`,currency:String(from.currency??'SAR'),lines:[{accountId:String(to.account_id),debit:input.amount,description:`Transfer from ${from.name}`},{accountId:String(from.account_id),credit:input.amount,description:`Transfer to ${to.name}`}],userId:input.userId,reason:'Bank transfer'})
  return {id:transferId,transferNo:input.transferNo}
}
