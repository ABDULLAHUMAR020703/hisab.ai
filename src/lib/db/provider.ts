import 'server-only'
import { supabaseAccountRepository } from './repositories/account.repository.supabase'
import type { AccountRepository } from './repositories/account.repository.interface'
import { supabaseAuditRepository } from './repositories/audit.repository.supabase'
import type { AuditRepository } from './repositories/audit.repository.interface'
import { supabaseCostCenterRepository } from './repositories/cost-center.repository.supabase'
import type { CostCenterRepository } from './repositories/cost-center.repository.interface'
import { supabaseCustomerRepository } from './repositories/customer.repository.supabase'
import type { CustomerRepository } from './repositories/customer.repository.interface'
import { supabaseDashboardRepository } from './repositories/dashboard.repository.supabase'
import type { DashboardRepository } from './repositories/dashboard.repository.interface'
import { supabaseEmployeeRepository } from './repositories/employee.repository.supabase'
import type { EmployeeRepository } from './repositories/employee.repository.interface'
import { supabaseInventoryRepository } from './repositories/inventory.repository.supabase'
import type { InventoryRepository } from './repositories/inventory.repository.interface'
import { supabaseInvoiceRepository } from './repositories/invoice.repository.supabase'
import type { InvoiceRepository } from './repositories/invoice.repository.interface'
import { supabasePayrollRepository } from './repositories/payroll.repository.supabase'
import type { PayrollRepository } from './repositories/payroll.repository.interface'
import { supabaseSequenceRepository } from './repositories/sequence.repository.supabase'
import type { SequenceRepository } from './repositories/sequence.repository.interface'
import { supabaseSettingsRepository } from './repositories/settings.supabase'
import type { SettingsRepository } from './repositories/settings.interface'
import { supabaseTaxRateRepository } from './repositories/tax-rate.repository.supabase'
import type { TaxRateRepository } from './repositories/tax-rate.repository.interface'
import { supabaseVendorRepository } from './repositories/vendor.repository.supabase'
import type { VendorRepository } from './repositories/vendor.repository.interface'

export function getSettingsRepository(): SettingsRepository {
  return supabaseSettingsRepository
}

export function getCustomerRepository(): CustomerRepository {
  return supabaseCustomerRepository
}

export function getVendorRepository(): VendorRepository {
  return supabaseVendorRepository
}

export function getSequenceRepository(): SequenceRepository {
  return supabaseSequenceRepository
}

export function getAccountRepository(): AccountRepository {
  return supabaseAccountRepository
}

export function getInvoiceRepository(): InvoiceRepository {
  return supabaseInvoiceRepository
}

export function getInventoryRepository(): InventoryRepository {
  return supabaseInventoryRepository
}

export function getPayrollRepository(): PayrollRepository {
  return supabasePayrollRepository
}

export function getAuditRepository(): AuditRepository {
  return supabaseAuditRepository
}

export function getDashboardRepository(): DashboardRepository {
  return supabaseDashboardRepository
}

export function getCostCenterRepository(): CostCenterRepository {
  return supabaseCostCenterRepository
}

export function getEmployeeRepository(): EmployeeRepository {
  return supabaseEmployeeRepository
}

export function getTaxRateRepository(): TaxRateRepository {
  return supabaseTaxRateRepository
}
