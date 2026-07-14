import 'server-only'
import { requireRole } from '@/lib/authz'
import type { CompanyRole } from '@/lib/db/types'

const ADMIN_ROLES: CompanyRole[] = ['OWNER', 'ADMIN']

export async function requirePlatformAdmin() {
  return requireRole(ADMIN_ROLES)
}

export function isCronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const header = request.headers.get('x-cron-secret') ?? request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  return header === secret
}
