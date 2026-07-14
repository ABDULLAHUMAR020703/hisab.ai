import 'server-only'
import { resolveCompanyId, supabaseDb } from '@/lib/db/repository-utils'
import type { MappingTemplateRecord } from '../types'

function mapTemplateRow(row: Record<string, unknown>): MappingTemplateRecord {
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    moduleKey: String(row.module_key),
    name: String(row.name),
    isDefault: Boolean(row.is_default),
    columnMapping: (row.column_mapping ?? {}) as Record<string, string>,
    headerFingerprint: row.header_fingerprint ? String(row.header_fingerprint) : null,
    createdById: row.created_by_id ? String(row.created_by_id) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

export async function listMappingTemplates(moduleKey: string): Promise<MappingTemplateRecord[]> {
  const db = supabaseDb()
  const companyId = await resolveCompanyId()
  const { data, error } = await db
    .from('import_mapping_templates')
    .select('*')
    .eq('company_id', companyId)
    .eq('module_key', moduleKey)
    .order('is_default', { ascending: false })
    .order('name', { ascending: true })

  if (error) throw error
  return (data ?? []).map(mapTemplateRow)
}

export async function createMappingTemplate(input: {
  moduleKey: string
  name: string
  columnMapping: Record<string, string>
  headerFingerprint?: string | null
  isDefault?: boolean
  createdById: string
}): Promise<MappingTemplateRecord> {
  const db = supabaseDb()
  const companyId = await resolveCompanyId()

  if (input.isDefault) {
    await db
      .from('import_mapping_templates')
      .update({ is_default: false })
      .eq('company_id', companyId)
      .eq('module_key', input.moduleKey)
  }

  const { data, error } = await db
    .from('import_mapping_templates')
    .insert({
      company_id: companyId,
      module_key: input.moduleKey,
      name: input.name,
      column_mapping: input.columnMapping,
      header_fingerprint: input.headerFingerprint ?? null,
      is_default: input.isDefault ?? false,
      created_by_id: input.createdById,
    })
    .select('*')
    .single()

  if (error) throw error
  return mapTemplateRow(data)
}

export async function updateMappingTemplate(
  id: string,
  input: Partial<{
    name: string
    columnMapping: Record<string, string>
    headerFingerprint: string | null
    isDefault: boolean
  }>,
): Promise<MappingTemplateRecord> {
  const db = supabaseDb()
  const companyId = await resolveCompanyId()

  if (input.isDefault) {
    const { data: existing } = await db
      .from('import_mapping_templates')
      .select('module_key')
      .eq('id', id)
      .eq('company_id', companyId)
      .single()

    if (existing?.module_key) {
      await db
        .from('import_mapping_templates')
        .update({ is_default: false })
        .eq('company_id', companyId)
        .eq('module_key', existing.module_key)
    }
  }

  const patch: Record<string, unknown> = {}
  if (input.name !== undefined) patch.name = input.name
  if (input.columnMapping !== undefined) patch.column_mapping = input.columnMapping
  if (input.headerFingerprint !== undefined) patch.header_fingerprint = input.headerFingerprint
  if (input.isDefault !== undefined) patch.is_default = input.isDefault

  const { data, error } = await db
    .from('import_mapping_templates')
    .update(patch)
    .eq('id', id)
    .eq('company_id', companyId)
    .select('*')
    .single()

  if (error) throw error
  return mapTemplateRow(data)
}

export async function deleteMappingTemplate(id: string): Promise<void> {
  const db = supabaseDb()
  const companyId = await resolveCompanyId()
  const { error } = await db
    .from('import_mapping_templates')
    .delete()
    .eq('id', id)
    .eq('company_id', companyId)

  if (error) throw error
}

export async function findTemplateByFingerprint(
  moduleKey: string,
  headerFingerprint: string,
): Promise<MappingTemplateRecord | null> {
  const db = supabaseDb()
  const companyId = await resolveCompanyId()
  const { data, error } = await db
    .from('import_mapping_templates')
    .select('*')
    .eq('company_id', companyId)
    .eq('module_key', moduleKey)
    .eq('header_fingerprint', headerFingerprint)
    .order('is_default', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return data ? mapTemplateRow(data) : null
}
