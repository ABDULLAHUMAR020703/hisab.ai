import 'server-only'
import { requireAuth } from '@/lib/auth'
import type { CompanyRole } from '@/lib/db/types'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCompanyId } from '@/lib/tenant'

export class ForbiddenError extends Error {
  constructor(message = 'Forbidden') {
    super(message)
    this.name = 'ForbiddenError'
  }
}

export async function requireRole(roles: CompanyRole[]) {
  const user = await requireAuth()
  const companyId = await resolveCompanyId()
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('company_users')
    .select('role')
    .eq('company_id', companyId)
    .eq('user_id', user.id)
    .eq('is_active', true)
    .maybeSingle()

  if (error) throw error
  if (!data || !roles.includes(data.role as CompanyRole)) {
    throw new ForbiddenError()
  }

  return { ...user, companyId, role: data.role as CompanyRole }
}

export function authzErrorResponse(error: unknown) {
  if (error instanceof Error && error.message === 'Unauthorized') {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (error instanceof ForbiddenError) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }
  return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
}
