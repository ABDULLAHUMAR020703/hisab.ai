import { loadEnvConfig } from '@next/env'
loadEnvConfig(process.cwd())

async function main(){
  const {createAdminClient}=await import('../../src/lib/supabase/admin')
  const db=createAdminClient()
  const provider=await db.from('accounting_integration_providers').select('id').eq('slug','quickbooks').single()
  if(provider.error)throw provider.error
  const connection=await db.from('accounting_integration_connections').select('tenant_id,realm_id').eq('provider_id',provider.data.id).eq('status','CONNECTED').order('updated_at',{ascending:false}).limit(1).single()
  if(connection.error)throw connection.error
  const companyId=String(connection.data.tenant_id),realmId=String(connection.data.realm_id)
  const records=await db.from('quickbooks_migration_records').select('entity_type,source_id,local_table,local_id,imported_at').eq('company_id',companyId).eq('realm_id',realmId).in('entity_type',['TaxCode','RecurringTransaction','Preferences','preferences']).order('entity_type').order('source_id')
  if(records.error)throw records.error
  const links=await db.from('quickbooks_migration_local_links').select('entity_type,source_id,local_table,local_id').eq('company_id',companyId).eq('realm_id',realmId).in('entity_type',['TaxCode','RecurringTransaction','Preferences','preferences']).order('entity_type').order('source_id')
  if(links.error)throw links.error
  const adjustments=await db.from('quickbooks_migration_records').select('source_id,source_payload,local_table,local_id').eq('company_id',companyId).eq('realm_id',realmId).eq('entity_type','InventoryAdjustment').order('source_id')
  if(adjustments.error)throw adjustments.error
  const adjustmentLinks=await db.from('quickbooks_migration_local_links').select('source_id,local_table,local_id').eq('company_id',companyId).eq('realm_id',realmId).eq('entity_type','InventoryAdjustment').order('source_id')
  if(adjustmentLinks.error)throw adjustmentLinks.error
  const failedInvoices=await db.from('quickbooks_materialization_runs').select('source_id,local_id,status,last_error').eq('company_id',companyId).eq('realm_id',realmId).eq('module_key','invoices').eq('status','failed')
  if(failedInvoices.error)throw failedInvoices.error
  const invoiceSources=await db.from('quickbooks_migration_records').select('source_id,source_payload,local_id').eq('company_id',companyId).eq('realm_id',realmId).eq('entity_type','Invoice').in('source_id',(failedInvoices.data??[]).map(row=>row.source_id))
  if(invoiceSources.error)throw invoiceSources.error
  const itemLinks=await db.from('quickbooks_migration_local_links').select('source_id,local_id').eq('company_id',companyId).eq('realm_id',realmId).eq('entity_type','Item')
  if(itemLinks.error)throw itemLinks.error
  const inventory=await db.from('inventory_items').select('id,item_code,name,category,allow_negative_stock').eq('company_id',companyId).in('id',(itemLinks.data??[]).map(row=>row.local_id))
  if(inventory.error)throw inventory.error
  const specialInvoices=await db.from('quickbooks_migration_records').select('source_id,source_payload,local_id').eq('company_id',companyId).eq('realm_id',realmId).eq('entity_type','Invoice').in('source_id',['27','70','129'])
  if(specialInvoices.error)throw specialInvoices.error
  const nativeInvoices=await db.from('invoices').select('id,legacy_id,invoice_no,status,subtotal,tax_amount,total,deleted_at,lines:invoice_lines(id,inventory_item_id,account_id,amount,quantity,unit_price,tax_rate)').eq('company_id',companyId).or('legacy_id.in.(27,70,129),invoice_no.eq.1009')
  if(nativeInvoices.error)throw nativeInvoices.error
  const nativeIds=(nativeInvoices.data??[]).map(row=>row.id),ledger=await db.from('ledger_entries').select('source_id,source_type,account_id,debit,credit').eq('company_id',companyId).in('source_id',nativeIds)
  if(ledger.error)throw ledger.error
  console.log(JSON.stringify({records:records.data,links:links.data,adjustments:adjustments.data,adjustmentLinks:adjustmentLinks.data,failedInvoices:failedInvoices.data,invoiceSources:invoiceSources.data,itemLinks:itemLinks.data,inventory:inventory.data,specialInvoices:specialInvoices.data,nativeInvoices:nativeInvoices.data,ledger:ledger.data},null,2))
}
main().catch(error=>{console.error(error);process.exitCode=1})
