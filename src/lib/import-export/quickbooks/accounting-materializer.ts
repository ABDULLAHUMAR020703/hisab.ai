import 'server-only'
import { postBillToLedger, postExpenseToLedger, postInvoiceToLedger, postPaymentToLedger, postPayrollToLedger, postSalesReceiptToLedger, postVendorCreditToLedger } from '@/lib/accounting/document-posting'
import { postSourceDocumentToLedger } from '@/lib/accounting/posting-service'
import { createAdminClient } from '@/lib/supabase/admin'

type Row = Record<string,unknown>

async function postQuickBooksJournal(id:string,companyId:string,sourceRow:Row){const db=createAdminClient(),entry=await db.from('journal_entries').select('entry_no,date,description,currency,exchange_rate').eq('company_id',companyId).eq('id',id).single();if(entry.error)throw entry.error;const lines=await db.from('journal_lines').select('account_id,debit,credit,description,cost_center_id').eq('company_id',companyId).eq('journal_id',id);if(lines.error)throw lines.error;const rate=Number(sourceRow.exchangeRate??entry.data.exchange_rate??1);await postSourceDocumentToLedger({companyId,sourceType:'JOURNAL',sourceId:id,entryDate:new Date(String(entry.data.date)),description:String(entry.data.description),currency:String(entry.data.currency),lines:(lines.data??[]).map(line=>({accountId:String(line.account_id),debit:Number(line.debit),credit:Number(line.credit),description:String(line.description??entry.data.description),costCenterId:line.cost_center_id?String(line.cost_center_id):null,exchangeRateOverride:rate}))});const ledger=await db.from('ledger_entries').select('posting_sequence').eq('company_id',companyId).eq('source_type','JOURNAL').eq('source_id',id).order('posting_sequence',{ascending:false}).limit(1).maybeSingle();if(ledger.error)throw ledger.error;const updated=await db.from('journal_entries').update({status:'POSTED',posting_sequence:Number(ledger.data?.posting_sequence??0),exchange_rate:rate}).eq('company_id',companyId).eq('id',id);if(updated.error)throw updated.error}

const CONFIG: Record<string,{ table:string; sourceType:string; post?:(id:string,companyId:string,sourceRow:Row)=>Promise<unknown>; requiresLedger:boolean; checksInventory?:boolean; allowsCreditOnlyApplication?:boolean; manualReason?:string }> = {
  invoices:{ table:'invoices', sourceType:'INVOICE', post:postInvoiceToLedger, requiresLedger:true, checksInventory:true },
  bills:{ table:'bills', sourceType:'BILL', post:postBillToLedger, requiresLedger:true, checksInventory:true },
  expenses:{ table:'expenses', sourceType:'EXPENSE', post:postExpenseToLedger, requiresLedger:true },
  'customer-payments':{ table:'payments', sourceType:'PAYMENT', post:postPaymentToLedger, requiresLedger:true },
  'vendor-payments':{ table:'payments', sourceType:'PAYMENT', post:postPaymentToLedger, requiresLedger:true, allowsCreditOnlyApplication:true },
  'journal-entries':{ table:'journal_entries', sourceType:'JOURNAL', post:postQuickBooksJournal, requiresLedger:true },
  payroll:{ table:'payroll_entries', sourceType:'PAYROLL', post:postPayrollToLedger, requiresLedger:true },
  estimates:{ table:'estimates', sourceType:'ESTIMATE', requiresLedger:false },
  'purchase-orders':{ table:'purchase_orders', sourceType:'PURCHASE_ORDER', requiresLedger:false },
  'sales-receipts':{ table:'sales_receipts', sourceType:'SALES_RECEIPT', post:postSalesReceiptToLedger, requiresLedger:true, checksInventory:true },
  'vendor-credits':{ table:'vendor_credits', sourceType:'SUPPLIER_CREDIT', post:postVendorCreditToLedger, requiresLedger:true, checksInventory:true },
}

function text(value:unknown) { return value === null || value === undefined ? '' : String(value) }

export async function hasPostedLedger(companyId:string,moduleKey:string,localId:string) {
  const config = CONFIG[moduleKey]
  if (!config?.requiresLedger) return false
  const result = await createAdminClient().from('ledger_entries').select('id').eq('company_id',companyId).eq('source_type',config.sourceType).eq('source_id',localId).limit(1)
  if (result.error) throw result.error
  return Boolean(result.data?.length)
}

export async function getQuickBooksMaterializationStatus(companyId:string,moduleKey:string,localId:string) {
  const result = await createAdminClient().from('quickbooks_materialization_runs').select('status').eq('company_id',companyId).eq('module_key',moduleKey).eq('local_id',localId).maybeSingle()
  if (result.error) throw result.error
  return result.data?.status ? String(result.data.status) : null
}

export async function materializeQuickBooksAccounting(input:{ companyId:string; userId:string; moduleKey:string; localId:string; sourceRow:Row }) {
  const config = CONFIG[input.moduleKey]
  if (!config) return { status:'manual_required' as const, ledgerEntryCount:0, inventoryMovementCount:0 }
  const realmId = text(input.sourceRow._realmId)
  const entityType = text(input.sourceRow._quickbooksEntity)
  const sourceId = text(input.sourceRow._quickbooksId ?? input.sourceRow.sourceId)
  if (!realmId || !entityType || !sourceId) return { status:'not_quickbooks' as const, ledgerEntryCount:0, inventoryMovementCount:0 }
  const db = createAdminClient()
  const existing = await db.from('quickbooks_materialization_runs').select('*').eq('company_id',input.companyId).eq('realm_id',realmId).eq('entity_type',entityType).eq('source_id',sourceId).eq('module_key',input.moduleKey).maybeSingle()
  if (existing.error) throw existing.error
  if (existing.data?.status === 'completed' && existing.data.local_id === input.localId) {
    return { status:'completed' as const, ledgerEntryCount:Number(existing.data.ledger_entry_count), inventoryMovementCount:Number(existing.data.inventory_movement_count) }
  }
  if (config.manualReason) {
    const manual = await db.from('quickbooks_materialization_runs').upsert({ company_id:input.companyId, realm_id:realmId, entity_type:entityType, source_id:sourceId, module_key:input.moduleKey, local_table:config.table, local_id:input.localId, status:'manual_required', attempt_count:Number(existing.data?.attempt_count ?? 0), validation:{ sourceId, reason:config.manualReason }, last_error:config.manualReason, updated_at:new Date().toISOString() }, { onConflict:'company_id,realm_id,entity_type,source_id,module_key' })
    if (manual.error) throw manual.error
    return { status:'manual_required' as const, ledgerEntryCount:0, inventoryMovementCount:0 }
  }
  const started = await db.from('quickbooks_materialization_runs').upsert({ company_id:input.companyId, realm_id:realmId, entity_type:entityType, source_id:sourceId, module_key:input.moduleKey, local_table:config.table, local_id:input.localId, status:'posting', attempt_count:Number(existing.data?.attempt_count ?? 0) + 1, started_at:new Date().toISOString(), last_error:null, updated_at:new Date().toISOString() }, { onConflict:'company_id,realm_id,entity_type,source_id,module_key' })
  if (started.error) throw started.error
  try {
    if (config.post) await config.post(input.localId,input.companyId,input.sourceRow)
    const ledger = await db.from('ledger_entries').select('id').eq('company_id',input.companyId).eq('source_type',config.sourceType).eq('source_id',input.localId)
    if (ledger.error) throw ledger.error
    const inventory = config.checksInventory ? await db.from('stock_movements').select('id').eq('company_id',input.companyId).eq('source_type',config.sourceType).eq('source_id',input.localId) : { data:[] as Array<{id:string}>, error:null }
    if (inventory.error) throw inventory.error
    const ledgerEntryCount = ledger.data?.length ?? 0
    const inventoryMovementCount = inventory.data?.length ?? 0
    let creditOnlyApplication=false
    if(config.allowsCreditOnlyApplication&&ledgerEntryCount<2){const [payment,allocations]=await Promise.all([db.from('payments').select('amount').eq('company_id',input.companyId).eq('id',input.localId).single(),db.from('payment_allocations').select('credit_amount').eq('company_id',input.companyId).eq('payment_id',input.localId)]);if(payment.error)throw payment.error;if(allocations.error)throw allocations.error;creditOnlyApplication=Number(payment.data.amount)===0&&(allocations.data??[]).reduce((sum,item)=>sum+Number(item.credit_amount),0)>0}
    if (config.requiresLedger && ledgerEntryCount < 2&&!creditOnlyApplication) throw new Error(`Native ${input.moduleKey} posting did not produce a balanced ledger entry.`)
    const completed = await db.from('quickbooks_materialization_runs').update({ status:'completed', ledger_entry_count:ledgerEntryCount, inventory_movement_count:inventoryMovementCount, validation:{ balancedLedger:!config.requiresLedger || ledgerEntryCount >= 2, creditOnlyApplication, inventoryChecked:Boolean(config.checksInventory), sourceId }, completed_at:new Date().toISOString(), updated_at:new Date().toISOString() }).eq('company_id',input.companyId).eq('realm_id',realmId).eq('entity_type',entityType).eq('source_id',sourceId).eq('module_key',input.moduleKey)
    if (completed.error) throw completed.error
    return { status:'completed' as const, ledgerEntryCount, inventoryMovementCount }
  } catch (error) {
    await db.from('quickbooks_materialization_runs').update({ status:'failed', last_error:error instanceof Error ? error.message : String(error), updated_at:new Date().toISOString() }).eq('company_id',input.companyId).eq('realm_id',realmId).eq('entity_type',entityType).eq('source_id',sourceId).eq('module_key',input.moduleKey)
    throw error
  }
}

export async function markQuickBooksMaterializationConflict(input:{ companyId:string; moduleKey:string; localId:string; sourceRow:Row; message:string }) {
  const config = CONFIG[input.moduleKey]
  const realmId=text(input.sourceRow._realmId); const entityType=text(input.sourceRow._quickbooksEntity); const sourceId=text(input.sourceRow._quickbooksId ?? input.sourceRow.sourceId)
  if (!config || !realmId || !entityType || !sourceId) return
  const result = await createAdminClient().from('quickbooks_materialization_runs').upsert({ company_id:input.companyId, realm_id:realmId, entity_type:entityType, source_id:sourceId, module_key:input.moduleKey, local_table:config.table, local_id:input.localId, status:'conflict', last_error:input.message, updated_at:new Date().toISOString() }, { onConflict:'company_id,realm_id,entity_type,source_id,module_key' })
  if (result.error) throw result.error
}
