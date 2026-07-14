import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCompanyId } from '@/lib/tenant'

export async function listCompanyRows<T extends Record<string, unknown>>(
  table: string,
  options?: { orderBy?: string; ascending?: boolean; filters?: Record<string, unknown> },
): Promise<T[]> {
  const companyId = await resolveCompanyId()
  const client = createAdminClient()
  let query = client.from(table).select('*').eq('company_id', companyId)

  if (options?.filters) {
    for (const [key, value] of Object.entries(options.filters)) {
      if (value !== undefined && value !== null && value !== '') {
        query = query.eq(key, value)
      }
    }
  }

  const { data, error } = await query.order(options?.orderBy ?? 'created_at', {
    ascending: options?.ascending ?? false,
  })

  if (error) throw error
  return (data ?? []) as T[]
}

export async function getCompanyRow<T extends Record<string, unknown>>(
  table: string,
  id: string,
): Promise<T | null> {
  const companyId = await resolveCompanyId()
  const client = createAdminClient()
  const { data, error } = await client
    .from(table)
    .select('*')
    .eq('company_id', companyId)
    .eq('id', id)
    .maybeSingle()

  if (error) throw error
  return (data as T | null) ?? null
}

export async function insertCompanyRow<T extends Record<string, unknown>>(
  table: string,
  row: Record<string, unknown>,
): Promise<T> {
  const companyId = await resolveCompanyId()
  const client = createAdminClient()
  const { data, error } = await client
    .from(table)
    .insert({ ...row, company_id: companyId })
    .select('*')
    .single()

  if (error) throw error
  return data as T
}

export async function updateCompanyRow<T extends Record<string, unknown>>(
  table: string,
  id: string,
  patch: Record<string, unknown>,
): Promise<T> {
  const companyId = await resolveCompanyId()
  const client = createAdminClient()
  const { data, error } = await client
    .from(table)
    .update(patch)
    .eq('company_id', companyId)
    .eq('id', id)
    .select('*')
    .single()

  if (error) throw error
  return data as T
}

export async function deleteCompanyRow(table: string, id: string): Promise<void> {
  const companyId = await resolveCompanyId()
  const client = createAdminClient()
  const { error } = await client.from(table).delete().eq('company_id', companyId).eq('id', id)
  if (error) throw error
}
