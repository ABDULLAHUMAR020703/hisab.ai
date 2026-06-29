import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function supabaseDb(client?: SupabaseClient): SupabaseClient {
  return client ?? createAdminClient()
}

export { resolveCompanyId, resolveCompanyIdOrThrow, TenantAccessError } from '@/lib/tenant'

export function isUuid(value: string): boolean {
  return UUID_RE.test(value)
}

export function toNumber(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string') return parseFloat(value) || 0
  return 0
}

export function toDate(value: string | null | undefined): Date | null {
  if (!value) return null
  return new Date(value)
}

export function requireDate(value: string): Date {
  return new Date(value)
}

/** Lookup by UUID primary key or Phase C `legacy_id` (SQLite cuid). */
export async function queryByIdOrLegacy(
  client: SupabaseClient,
  table: string,
  id: string,
  companyId: string,
): Promise<Record<string, unknown> | null> {
  const base = client.from(table).select('*').eq('company_id', companyId).is('deleted_at', null)

  if (isUuid(id)) {
    const { data, error } = await base.eq('id', id).maybeSingle()
    if (error) throw error
    return data
  }

  const { data, error } = await base.eq('legacy_id', id).maybeSingle()
  if (error) throw error
  return data
}

export function ilikeFilter(column: string, search: string): string {
  return `${column}.ilike.%${search.replace(/[%_]/g, '\\$&')}%`
}
