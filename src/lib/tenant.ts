import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getAppUser } from '@/lib/supabase/auth-users'
import { createClient } from '@/lib/supabase/server'
import { TenantAccessError } from '@/lib/tenant-error'

export { TenantAccessError } from '@/lib/tenant-error'

/** Resolve the authenticated user's active company. Never falls back to a shared/default tenant. */
export async function resolveCompanyId(_client?: SupabaseClient): Promise<string> {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.getUser()

  if (error || !data.user?.email) {
    throw new TenantAccessError('Authentication required')
  }

  const user = await getAppUser(data.user.id, data.user.email)
  if (!user.companyId) {
    throw new TenantAccessError()
  }
  return user.companyId
}

/** Optional company id for background jobs that already know the tenant. */
export async function resolveCompanyIdOrThrow(companyId?: string): Promise<string> {
  if (companyId) return companyId
  return resolveCompanyId()
}
