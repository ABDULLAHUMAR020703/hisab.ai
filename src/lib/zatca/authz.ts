import 'server-only'
import { requireAuth, type AppUser } from '@/lib/auth'

const ZATCA_ADMIN_ROLES = new Set(['OWNER', 'ADMIN'])
const ZATCA_SUBMIT_ROLES = new Set(['OWNER', 'ADMIN', 'ACCOUNTANT'])

export class ZatcaForbiddenError extends Error {
  constructor(message = 'Insufficient permissions for this ZATCA operation') {
    super(message)
    this.name = 'ZatcaForbiddenError'
  }
}

export async function requireZatcaAdmin(): Promise<AppUser> {
  const user = await requireAuth()
  if (!ZATCA_ADMIN_ROLES.has(user.role)) {
    throw new ZatcaForbiddenError('Only company owners and administrators can manage ZATCA connections.')
  }
  return user
}

export async function requireZatcaSubmit(): Promise<AppUser> {
  const user = await requireAuth()
  if (!ZATCA_SUBMIT_ROLES.has(user.role)) {
    throw new ZatcaForbiddenError('Only owners, administrators, and accountants can submit invoices to ZATCA.')
  }
  return user
}

export async function requireZatcaOwner(): Promise<AppUser> {
  const user = await requireAuth()
  if (user.role !== 'OWNER') {
    throw new ZatcaForbiddenError('Only company owners can delete local ZATCA credentials.')
  }
  return user
}

export function isZatcaAdmin(user: AppUser): boolean {
  return ZATCA_ADMIN_ROLES.has(user.role)
}
