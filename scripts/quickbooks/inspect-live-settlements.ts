import { loadEnvConfig } from '@next/env'
loadEnvConfig(process.cwd())

async function main(){
  const {createAdminClient}=await import('../../src/lib/supabase/admin'),db=createAdminClient()
  const provider=await db.from('accounting_integration_providers').select('id').eq('slug','quickbooks').single();if(provider.error)throw provider.error
  const connection=await db.from('accounting_integration_connections').select('tenant_id,realm_id').eq('provider_id',provider.data.id).eq('status','CONNECTED').order('updated_at',{ascending:false}).limit(1).single();if(connection.error)throw connection.error
  const companyId=String(connection.data.tenant_id),realmId=String(connection.data.realm_id)
  const records=await db.from('quickbooks_migration_records').select('entity_type,source_id,source_payload,local_table,local_id,imported_at').eq('company_id',companyId).eq('realm_id',realmId).or('and(entity_type.eq.Payment,source_id.eq.74),and(entity_type.eq.CreditMemo,source_id.eq.73),and(entity_type.eq.Deposit,source_id.in.(4,5,62,121))').order('entity_type').order('source_id');if(records.error)throw records.error
  const links=await db.from('quickbooks_migration_local_links').select('entity_type,source_id,local_table,local_id,updated_at').eq('company_id',companyId).eq('realm_id',realmId).or('and(entity_type.eq.Payment,source_id.eq.74),and(entity_type.eq.CreditMemo,source_id.eq.73),and(entity_type.eq.Deposit,source_id.in.(4,5,62,121))').order('entity_type').order('source_id');if(links.error)throw links.error
  console.log(JSON.stringify({records:records.data,links:links.data},null,2))
}
main().catch(error=>{console.error(error);process.exitCode=1})
