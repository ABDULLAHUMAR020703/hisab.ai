import 'server-only'
import { createHash } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'

type Row = Record<string, unknown>
const QUICKBOOKS_MAPPING_VERSION='2026-08-02-operational-v4'

function sourcePayloadHash(raw:Row,entityType:string){
  const mappingVersion=entityType==='Item'?`${QUICKBOOKS_MAPPING_VERSION}:`:''
  return createHash('sha256').update(`${mappingVersion}${JSON.stringify(raw)}`).digest('hex')
}

export function parseQuickBooksRaw(row: Row): Row {
  if (typeof row._quickbooksRaw === 'string') {
    try { return JSON.parse(row._quickbooksRaw) as Row } catch { return {} }
  }
  return row._quickbooksRaw && typeof row._quickbooksRaw === 'object' ? row._quickbooksRaw as Row : row
}

function collectRelationships(value: unknown, path = '', output: Array<{ path: string; type?: string; value: string; name?: string }> = []) {
  if (Array.isArray(value)) value.forEach((item, index) => collectRelationships(item, `${path}[${index}]`, output))
  else if (value && typeof value === 'object') {
    const object = value as Row
    if ((path.endsWith('Ref') || path.includes('LinkedTxn')) && (object.value ?? object.TxnId)) {
      output.push({ path, type: String(object.type ?? object.TxnType ?? ''), value: String(object.value ?? object.TxnId), name: object.name ? String(object.name) : undefined })
    }
    for (const [key, child] of Object.entries(object)) collectRelationships(child, path ? `${path}.${key}` : key, output)
  }
  return output
}

export async function archiveQuickBooksRecord(input: { companyId: string; realmId: string; entityType: string; row: Row; localTable?: string; localId?: string; partition?: string }) {
  const raw = parseQuickBooksRaw(input.row)
  const sourceId = String(raw.Id ?? input.row._quickbooksId ?? input.row.sourceId ?? '')
  if (!sourceId) throw new Error(`QuickBooks ${input.entityType} record is missing Id.`)
  const metadata = raw.MetaData && typeof raw.MetaData === 'object' ? raw.MetaData as Row : {}
  const record = {
    company_id: input.companyId,
    realm_id: input.realmId,
    entity_type: input.entityType,
    source_id: sourceId,
    sync_token: raw.SyncToken === undefined ? null : String(raw.SyncToken),
    source_created_at: metadata.CreateTime ?? null,
    source_updated_at: metadata.LastUpdatedTime ?? null,
    is_active: raw.Active === undefined ? null : Boolean(raw.Active),
    is_deleted: String(raw.status ?? '').toLowerCase() === 'deleted',
    source_payload: raw,
    payload_hash: sourcePayloadHash(raw,input.entityType),
    relationships: collectRelationships(raw),
    custom_fields: Array.isArray(raw.CustomField) ? raw.CustomField : [],
    currency_code: raw.CurrencyRef && typeof raw.CurrencyRef === 'object' ? String((raw.CurrencyRef as Row).value ?? '') || null : null,
    exchange_rate: raw.ExchangeRate === undefined ? null : Number(raw.ExchangeRate),
    ...(input.localTable !== undefined ? { local_table:input.localTable } : {}),
    ...(input.localId !== undefined ? { local_id:input.localId, imported_at:new Date().toISOString() } : {}),
    ...(input.partition !== undefined ? { extraction_partition:input.partition } : {}),
    updated_at: new Date().toISOString(),
  }
  const { data, error } = await createAdminClient().from('quickbooks_migration_records').upsert(record, { onConflict: 'company_id,realm_id,entity_type,source_id' }).select('*').single()
  if (error) throw error
  if (record.currency_code) {
    const currency = await createAdminClient().from('company_currencies').upsert({ company_id:input.companyId, code:record.currency_code, name:record.currency_code, is_primary:false, is_active:true }, { onConflict:'company_id,code' })
    if (currency.error) throw currency.error
    if(record.exchange_rate&&Number(record.exchange_rate)>0){const company=await createAdminClient().from('companies').select('currency').eq('id',input.companyId).single();if(company.error)throw company.error;const home=String(company.data.currency??'').toUpperCase(),date=String(raw.TxnDate??raw.TxnDateTime??metadata.CreateTime??'').slice(0,10);if(home&&record.currency_code!==home&&/^\d{4}-\d{2}-\d{2}$/.test(date)){const rate=await createAdminClient().from('exchange_rates').upsert({company_id:input.companyId,from_currency:record.currency_code,to_currency:home,rate:record.exchange_rate,effective_date:`${date}T00:00:00.000Z`,source:'QUICKBOOKS_TRANSACTION',is_manual_override:true,notes:`QuickBooks ${input.entityType} ${sourceId}`},{onConflict:'company_id,from_currency,to_currency,effective_date'});if(rate.error)throw rate.error}}
  }
  if (input.localId && input.localTable) {
    const linked = await createAdminClient().from('quickbooks_migration_local_links').upsert({ company_id:input.companyId, realm_id:input.realmId, entity_type:input.entityType, source_id:sourceId, local_table:input.localTable, local_id:input.localId, updated_at:new Date().toISOString() }, { onConflict:'company_id,realm_id,entity_type,source_id,local_table,local_id' })
    if (linked.error) throw linked.error
  }
  return data
}

export async function isQuickBooksRecordUnchanged(companyId:string,row:Row):Promise<boolean>{
  const realmId=String(row._realmId??''),entityType=String(row._quickbooksEntity??''),sourceId=String(row._quickbooksId??row.sourceId??'')
  if(!realmId||!entityType||!sourceId)return false
  const raw=parseQuickBooksRaw(row),payloadHash=sourcePayloadHash(raw,entityType)
  const existing=await createAdminClient().from('quickbooks_migration_records').select('payload_hash,local_id,imported_at').eq('company_id',companyId).eq('realm_id',realmId).eq('entity_type',entityType).eq('source_id',sourceId).maybeSingle()
  if(existing.error)throw existing.error
  return Boolean(existing.data?.local_id&&existing.data.imported_at&&existing.data.payload_hash===payloadHash)
}

export async function linkArchivedQuickBooksRecord(input: { companyId: string; realmId: string; entityType: string; sourceId: string; localTable: string; localId: string }) {
  const { error } = await createAdminClient().from('quickbooks_migration_records').update({ local_table: input.localTable, local_id: input.localId, imported_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('company_id', input.companyId).eq('realm_id', input.realmId).eq('entity_type', input.entityType).eq('source_id', input.sourceId)
  if (error) throw error
  const linked = await createAdminClient().from('quickbooks_migration_local_links').upsert({ company_id:input.companyId, realm_id:input.realmId, entity_type:input.entityType, source_id:input.sourceId, local_table:input.localTable, local_id:input.localId, updated_at:new Date().toISOString() }, { onConflict:'company_id,realm_id,entity_type,source_id,local_table,local_id' })
  if (linked.error) throw linked.error
}

export async function assertQuickBooksRecordLinked(companyId:string,row:Row,expectedLocalId:string){
  const realmId=String(row._realmId??''),entityType=String(row._quickbooksEntity??''),sourceId=String(row._quickbooksId??row.sourceId??'')
  if(!realmId||!entityType||!sourceId)return
  const db=createAdminClient()
  const record=await db.from('quickbooks_migration_records').select('local_id,local_table,imported_at').eq('company_id',companyId).eq('realm_id',realmId).eq('entity_type',entityType).eq('source_id',sourceId).maybeSingle()
  if(record.error)throw record.error
  if(!record.data?.local_id||!record.data.local_table||!record.data.imported_at)throw new Error(`QuickBooks ${entityType} ${sourceId} was preserved but did not complete native materialization.`)
  if(String(record.data.local_id)!==expectedLocalId)throw new Error(`QuickBooks ${entityType} ${sourceId} linked to an unexpected native record.`)
  const link=await db.from('quickbooks_migration_local_links').select('id').eq('company_id',companyId).eq('realm_id',realmId).eq('entity_type',entityType).eq('source_id',sourceId).eq('local_table',record.data.local_table).eq('local_id',expectedLocalId).maybeSingle()
  if(link.error)throw link.error
  if(!link.data)throw new Error(`QuickBooks ${entityType} ${sourceId} has no durable native migration link.`)
}

export async function recordQuickBooksWarning(input: { companyId: string; realmId: string; resourceKey: string; sourceId?: string; code: string; message: string; details?: Row }) {
  const { error } = await createAdminClient().from('quickbooks_migration_warnings').insert({ company_id: input.companyId, realm_id: input.realmId, resource_key: input.resourceKey, source_id: input.sourceId ?? null, code: input.code, message: input.message, details: input.details ?? {} })
  if (error) throw error
}

export async function findArchivedRecord(companyId: string, realmId: string, entityType: string, sourceId: string) {
  const { data, error } = await createAdminClient().from('quickbooks_migration_records').select('id,local_id,local_table,payload_hash,sync_token,is_deleted').eq('company_id', companyId).eq('realm_id', realmId).eq('entity_type', entityType).eq('source_id', sourceId).maybeSingle()
  if (error) throw error
  return data
}

export async function resolveQuickBooksLocalId(companyId: string, realmId: string, sourceId: string, entityTypes?: string[], localTables?: string[]) {
  let query = createAdminClient().from('quickbooks_migration_records').select('local_id,local_table').eq('company_id', companyId).eq('realm_id', realmId).eq('source_id', sourceId).not('local_id', 'is', null).limit(1)
  if (entityTypes?.length) query = query.in('entity_type', entityTypes)
  if (localTables?.length) query = query.in('local_table', localTables)
  const { data, error } = await query.maybeSingle()
  if (error) throw error
  if(data)return { id: String(data.local_id), table: String(data.local_table) }
  let linkQuery = createAdminClient().from('quickbooks_migration_local_links').select('local_id,local_table').eq('company_id',companyId).eq('realm_id',realmId).eq('source_id',sourceId).order('updated_at',{ascending:false}).limit(1)
  if (entityTypes?.length) linkQuery = linkQuery.in('entity_type',entityTypes)
  if (localTables?.length) linkQuery = linkQuery.in('local_table',localTables)
  const linked = await linkQuery.maybeSingle()
  if (linked.error) throw linked.error
  return linked.data ? { id:String(linked.data.local_id), table:String(linked.data.local_table) } : null
}

export async function resolveQuickBooksCustomerContext(companyId:string,realmId:string,sourceId:string) {
  const direct=await resolveQuickBooksLocalId(companyId,realmId,sourceId,['Customer'],['customers'])
  const project=await resolveQuickBooksLocalId(companyId,realmId,sourceId,['Customer'],['cost_centers'])
  if(direct)return {customerId:direct.id,projectId:project?.id??null}
  const archived=await createAdminClient().from('quickbooks_migration_records').select('source_payload').eq('company_id',companyId).eq('realm_id',realmId).eq('entity_type','Customer').eq('source_id',sourceId).maybeSingle()
  if(archived.error)throw archived.error
  const payload=(archived.data?.source_payload??{}) as Row
  const parent=payload.ParentRef&&typeof payload.ParentRef==='object'?String((payload.ParentRef as Row).value??''):''
  const customer=parent?await resolveQuickBooksLocalId(companyId,realmId,parent,['Customer'],['customers']):null
  return customer?{customerId:customer.id,projectId:project?.id??null}:null
}

export async function resolveQuickBooksInventoryItemId(companyId:string,realmId:string,sourceId:string) {
  const archived=await createAdminClient().from('quickbooks_migration_records').select('source_payload').eq('company_id',companyId).eq('realm_id',realmId).eq('entity_type','Item').eq('source_id',sourceId).maybeSingle()
  if(archived.error)throw archived.error
  const payload=(archived.data?.source_payload??{}) as Row
  if(String(payload.Type??'').toLowerCase()!=='inventory')return null
  return resolveQuickBooksLocalId(companyId,realmId,sourceId,['Item'],['inventory_items'])
}

export async function materializeQuickBooksCustomFields(input: { companyId:string; entityType:string; entityId:string; row:Row }) {
  const raw = parseQuickBooksRaw(input.row)
  const fields = Array.isArray(raw.CustomField) ? raw.CustomField as Row[] : []
  const db = createAdminClient()
  for (const field of fields) {
    const fieldKey = String(field.DefinitionId ?? field.Name ?? '').trim()
    if (!fieldKey) continue
    const label = String(field.Name ?? `QuickBooks field ${fieldKey}`)
    const type = field.Type === 'NumberType' ? 'NUMBER' : field.Type === 'DateType' ? 'DATE' : field.Type === 'BooleanType' ? 'BOOLEAN' : 'TEXT'
    const definition = await db.from('custom_field_definitions').upsert({ company_id:input.companyId, entity_type:input.entityType, field_key:`quickbooks_${fieldKey}`, field_label:label, field_type:type, is_required:false }, { onConflict:'company_id,entity_type,field_key' }).select('id').single()
    if (definition.error) throw definition.error
    const rawValue = field.StringValue ?? field.NumberValue ?? field.DateValue ?? field.BooleanValue
    const stored = await db.from('custom_field_values').upsert({ company_id:input.companyId, definition_id:definition.data.id, entity_id:input.entityId, value:rawValue === undefined || rawValue === null ? null : String(rawValue) }, { onConflict:'definition_id,entity_id' })
    if (stored.error) throw stored.error
  }
}

export async function applyQuickBooksDeletion(companyId:string, realmId:string, entityType:string, sourceId:string) {
  const db = createAdminClient()
  const links = await db.from('quickbooks_migration_local_links').select('local_table,local_id').eq('company_id',companyId).eq('realm_id',realmId).eq('entity_type',entityType).eq('source_id',sourceId)
  if (links.error) throw links.error
  const softDelete = new Set(['customers','vendors','inventory_items','chart_of_accounts','cost_centers','employees','departments'])
  const deleteOnly = new Set(['time_activities','recurring_transaction_templates'])
  const inactiveOnly = new Set(['tax_rates','payment_terms','company_currencies'])
  for (const link of links.data ?? []) {
    if (softDelete.has(link.local_table)) {
      const result = await db.from(link.local_table).update({ is_active:false, deleted_at:new Date().toISOString() }).eq('company_id',companyId).eq('id',link.local_id)
      if (result.error) throw result.error
    } else if (deleteOnly.has(link.local_table)) {
      const result = await db.from(link.local_table).update({ deleted_at:new Date().toISOString() }).eq('company_id',companyId).eq('id',link.local_id)
      if (result.error) throw result.error
    } else if (inactiveOnly.has(link.local_table)) {
      const result = await db.from(link.local_table).update({ is_active:false }).eq('company_id',companyId).eq('id',link.local_id)
      if (result.error) throw result.error
    }
  }
}
