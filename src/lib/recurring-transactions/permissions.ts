import type { AppUser } from '@/lib/auth'
import { ForbiddenError } from '@/lib/authz'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCompanyId } from '@/lib/tenant'

export type RecurringPermission = 'view' | 'create' | 'edit' | 'delete' | 'run' | 'pause' | 'resume' | 'export' | 'audit'

const ROLE_PERMISSIONS: Record<string, ReadonlySet<RecurringPermission>> = {
  OWNER: new Set(['view', 'create', 'edit', 'delete', 'run', 'pause', 'resume', 'export', 'audit']),
  ADMIN: new Set(['view', 'create', 'edit', 'delete', 'run', 'pause', 'resume', 'export', 'audit']),
  ACCOUNTANT: new Set(['view', 'create', 'edit', 'run', 'pause', 'resume', 'export', 'audit']),
  MANAGER: new Set(['view', 'create', 'edit', 'run', 'pause', 'resume', 'export']),
  AUDITOR: new Set(['view', 'export', 'audit']),
  VIEWER: new Set(['view', 'export', 'audit']),
  EMPLOYEE: new Set(),
}

export function canManageRecurring(role: string, permission: RecurringPermission) {
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false
}

export async function requireRecurringPermission(user: AppUser, permission: RecurringPermission) {
  const companyId = await resolveCompanyId()
  const { data, error } = await createAdminClient().from('company_users').select('role')
    .eq('company_id', companyId).eq('user_id', user.id).eq('is_active', true).maybeSingle()
  if (error) throw error
  const role = String(data?.role ?? '')
  if (!canManageRecurring(role, permission)) throw new ForbiddenError(`Missing recurring transactions permission: ${permission}`)
  return { companyId, role }
}
