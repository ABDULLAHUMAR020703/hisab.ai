import 'server-only'
import { isSupabaseEnabled } from '@/lib/supabase/env'
import { wrapRepository } from './parity'
import { prismaAccountRepository } from './repositories/account.repository.prisma'
import { supabaseAccountRepository } from './repositories/account.repository.supabase'
import type { AccountRepository } from './repositories/account.repository.interface'
import { prismaAuditRepository } from './repositories/audit.repository.prisma'
import { supabaseAuditRepository } from './repositories/audit.repository.supabase'
import type { AuditRepository } from './repositories/audit.repository.interface'
import { prismaCustomerRepository } from './repositories/customer.repository.prisma'
import { supabaseCustomerRepository } from './repositories/customer.repository.supabase'
import type { CustomerRepository } from './repositories/customer.repository.interface'
import { prismaDashboardRepository } from './repositories/dashboard.repository.prisma'
import { supabaseDashboardRepository } from './repositories/dashboard.repository.supabase'
import type { DashboardRepository } from './repositories/dashboard.repository.interface'
import { prismaInventoryRepository } from './repositories/inventory.repository.prisma'
import { supabaseInventoryRepository } from './repositories/inventory.repository.supabase'
import type { InventoryRepository } from './repositories/inventory.repository.interface'
import { prismaInvoiceRepository } from './repositories/invoice.repository.prisma'
import { supabaseInvoiceRepository } from './repositories/invoice.repository.supabase'
import type { InvoiceRepository } from './repositories/invoice.repository.interface'
import { prismaPayrollRepository } from './repositories/payroll.repository.prisma'
import { supabasePayrollRepository } from './repositories/payroll.repository.supabase'
import type { PayrollRepository } from './repositories/payroll.repository.interface'
import type { SequenceRepository } from './repositories/sequence.repository.interface'
import { prismaSettingsRepository } from './repositories/settings.prisma'
import { supabaseSettingsRepository } from './repositories/settings.supabase'
import type { SettingsRepository } from './repositories/settings.interface'
import { prismaVendorRepository } from './repositories/vendor.repository.prisma'
import { supabaseVendorRepository } from './repositories/vendor.repository.supabase'
import type { VendorRepository } from './repositories/vendor.repository.interface'
import { resolveSequenceRepository } from './sequence-resolver'

const CUSTOMER_WRITE_METHODS: (keyof CustomerRepository)[] = ['create', 'update', 'delete']
const VENDOR_WRITE_METHODS: (keyof VendorRepository)[] = ['create', 'update', 'delete']

function resolve<T extends object>(
  label: string,
  prismaRepo: T,
  supabaseRepo: T,
  readMethods: (keyof T)[],
  writeMethods: (keyof T)[] = [],
): T {
  if (isSupabaseEnabled()) return supabaseRepo
  return wrapRepository(label, prismaRepo, supabaseRepo, readMethods, writeMethods)
}

/** Routes and services must use these — never branch on USE_SUPABASE directly. */
export function getSettingsRepository(): SettingsRepository {
  return resolve('settings', prismaSettingsRepository, supabaseSettingsRepository, ['findFirst'], [
    'create',
    'update',
    'upsert',
  ])
}

export function getCustomerRepository(): CustomerRepository {
  return resolve(
    'customer',
    prismaCustomerRepository,
    supabaseCustomerRepository,
    ['findMany', 'findById'],
    CUSTOMER_WRITE_METHODS,
  )
}

export function getVendorRepository(): VendorRepository {
  return resolve(
    'vendor',
    prismaVendorRepository,
    supabaseVendorRepository,
    ['findMany', 'findById'],
    VENDOR_WRITE_METHODS,
  )
}

export function getSequenceRepository(): SequenceRepository {
  return resolveSequenceRepository()
}

export function getAccountRepository(): AccountRepository {
  return resolve('account', prismaAccountRepository, supabaseAccountRepository, ['findMany', 'findById'])
}

export function getInvoiceRepository(): InvoiceRepository {
  return resolve('invoice', prismaInvoiceRepository, supabaseInvoiceRepository, ['findMany', 'findById'])
}

export function getInventoryRepository(): InventoryRepository {
  return resolve('inventory', prismaInventoryRepository, supabaseInventoryRepository, ['findMany', 'findById'])
}

export function getPayrollRepository(): PayrollRepository {
  return resolve('payroll', prismaPayrollRepository, supabasePayrollRepository, ['findMany', 'findById'])
}

export function getAuditRepository(): AuditRepository {
  return resolve('audit', prismaAuditRepository, supabaseAuditRepository, ['findRecent'])
}

export function getDashboardRepository(): DashboardRepository {
  return resolve('dashboard', prismaDashboardRepository, supabaseDashboardRepository, ['getStats'])
}
