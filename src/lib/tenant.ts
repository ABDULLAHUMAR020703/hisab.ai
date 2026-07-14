import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { getAppUser } from '@/lib/supabase/auth-users'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { TenantAccessError } from '@/lib/tenant-error'

export { TenantAccessError } from '@/lib/tenant-error'

export const COMPANY_COOKIE = 'hisab_company_id'

async function validateCompanyAccess(userId: string, companyId: string): Promise<boolean> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('company_users')
    .select('id')
    .eq('company_id', companyId)
    .eq('user_id', userId)
    .eq('is_active', true)
    .maybeSingle()

  if (error) throw error
  return Boolean(data)
}

/** Resolve the authenticated user's active company. Never falls back to a shared/default tenant. */
export async function resolveCompanyId(_client?: SupabaseClient): Promise<string> {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.getUser()

  if (error || !data.user?.email) {
    throw new TenantAccessError('Authentication required')
  }

  const cookieStore = await cookies()
  const cookieCompanyId = cookieStore.get(COMPANY_COOKIE)?.value

  if (cookieCompanyId) {
    const allowed = await validateCompanyAccess(data.user.id, cookieCompanyId)
    if (allowed) return cookieCompanyId
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
