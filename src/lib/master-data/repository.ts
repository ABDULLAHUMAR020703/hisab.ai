import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCompanyId } from '@/lib/tenant'

type MasterTable =
  | 'units_of_measure'
  | 'warehouses'
  | 'payment_terms'
  | 'departments'
  | 'company_currencies'

const TABLE_CONFIG: Record<MasterTable, { codeField?: string; nameField: string }> = {
  units_of_measure: { codeField: 'code', nameField: 'name' },
  warehouses: { codeField: 'code', nameField: 'name' },
  payment_terms: { nameField: 'name' },
  departments: { codeField: 'code', nameField: 'name' },
  company_currencies: { codeField: 'code', nameField: 'name' },
}

export async function listMasterRecords(table: MasterTable, companyId?: string) {
  const cid = companyId ?? await resolveCompanyId()
  const client = createAdminClient()
  const { data, error } = await client
    .from(table)
    .select('*')
    .eq('company_id', cid)
    .is('deleted_at', null)
    .order('name', { ascending: true })

  if (error) throw error
  return data ?? []
}

export async function createMasterRecord(
  table: MasterTable,
  input: Record<string, unknown>,
  companyId?: string,
) {
  const cid = companyId ?? await resolveCompanyId()
  const client = createAdminClient()
  const { data, error } = await client
    .from(table)
    .insert({ ...input, company_id: cid })
    .select('*')
    .single()

  if (error) throw error
  return data
}

export async function updateMasterRecord(
  table: MasterTable,
  id: string,
  input: Record<string, unknown>,
  companyId?: string,
) {
  const cid = companyId ?? await resolveCompanyId()
  const client = createAdminClient()
  const { data, error } = await client
    .from(table)
    .update(input)
    .eq('id', id)
    .eq('company_id', cid)
    .select('*')
    .single()

  if (error) throw error
  return data
}

export async function deleteMasterRecord(table: MasterTable, id: string, companyId?: string) {
  const cid = companyId ?? await resolveCompanyId()
  const client = createAdminClient()
  const { error } = await client
    .from(table)
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('company_id', cid)

  if (error) throw error
}

export { TABLE_CONFIG }
