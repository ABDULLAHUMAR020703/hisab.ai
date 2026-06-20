import path from 'node:path'

/** Seeded default tenant — see supabase/seed/001_default_company.sql */
export const COMPANY_ID = '00000000-0000-4000-8000-000000000001'

/** UUIDv5 namespace for deterministic migration IDs */
export const MIGRATION_NAMESPACE = '00000000-0000-4000-8000-000000000099'

export const MIGRATION_ROOT = path.join(process.cwd(), 'data', 'migration')
export const EXPORT_DIR = path.join(MIGRATION_ROOT, 'export')
export const ID_MAP_FILE = path.join(MIGRATION_ROOT, 'migration_id_map.json')
export const MANIFEST_FILE = path.join(EXPORT_DIR, 'manifest.json')

export const DEFAULT_SQLITE_PATH = path.join(process.cwd(), 'prisma', 'dev.db')

/** Prisma models exported from SQLite (AppSession skipped) */
export const EXPORT_TABLES = [
  'CompanySettings',
  'User',
  'ChartOfAccount',
  'CostCenter',
  'TaxRate',
  'Sequence',
  'Customer',
  'Vendor',
  'Employee',
  'InventoryItem',
  'JournalEntry',
  'JournalLine',
  'Receipt',
  'Expense',
  'ExpenseLine',
  'Bill',
  'BillLine',
  'Invoice',
  'InvoiceLine',
  'Payment',
  'PayrollEntry',
  'PayrollLine',
  'ZatcaCredential',
  'ZatcaOnboardingRequest',
  'ZatcaAuditLog',
  'ZatcaSandboxTestRun',
] as const

export type ExportTable = (typeof EXPORT_TABLES)[number]

export const ENTITY_TYPES = [...EXPORT_TABLES] as const

export const USER_ROLE_MAP: Record<string, string> = {
  ADMIN: 'ADMIN',
  ACCOUNTANT: 'ACCOUNTANT',
  MANAGER: 'MANAGER',
  OWNER: 'OWNER',
}
