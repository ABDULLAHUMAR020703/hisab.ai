import 'server-only'
import type { CompanyRole } from '@/lib/db/types'
import { requireRole } from '@/lib/authz'

export const ACCOUNTING_READ_ROLES: CompanyRole[] = ['OWNER', 'ADMIN', 'ACCOUNTANT', 'MANAGER', 'AUDITOR']
export const ACCOUNTING_WRITE_ROLES: CompanyRole[] = ['OWNER', 'ADMIN', 'ACCOUNTANT', 'MANAGER']
export const ACCOUNTING_ADMIN_ROLES: CompanyRole[] = ['OWNER', 'ADMIN', 'ACCOUNTANT']

export const requireAccountingRead = () => requireRole(ACCOUNTING_READ_ROLES)
export const requireAccountingWrite = () => requireRole(ACCOUNTING_WRITE_ROLES)
export const requireAccountingAdmin = () => requireRole(ACCOUNTING_ADMIN_ROLES)
