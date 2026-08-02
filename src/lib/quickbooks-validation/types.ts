export const QUICKBOOKS_VALIDATION_MODULES = [
  'accounts',
  'customers',
  'vendors',
  'items',
  'tax-codes',
  'payment-terms',
  'invoices',
  'bills',
  'journal-entries',
  'expenses',
  'sales-receipts',
  'purchase-orders',
  'vendor-credits',
  'estimates',
  'customer-payments',
  'vendor-payments',
  'projects',
  'budgets',
  'exchange-rates',
  'classes',
  'departments',
  'employees',
  'time-activities',
  'credit-memos',
  'deposits',
  'transfers',
  'inventory-adjustments',
  'attachments',
  'recurring-transactions',
  'tax-agencies',
  'tax-configurations',
  'preferences',
  'fixed-assets',
] as const

export type QuickBooksValidationModule = (typeof QUICKBOOKS_VALIDATION_MODULES)[number]

export type ValidationIssueKind =
  | 'missing'
  | 'extra'
  | 'duplicate'
  | 'field_mismatch'
  | 'parent_mismatch'
  | 'invalid_enum'
  | 'null_mismatch'
  | 'mapping_mismatch'
  | 'relationship_mismatch'
  | 'total_mismatch'
  | 'tax_mismatch'

export interface QuickBooksValidationIssue {
  module: QuickBooksValidationModule
  kind: ValidationIssueKind
  key: string
  recordName: string
  quickBooksId?: string
  realmId?: string
  field?: string
  quickBooksValue?: unknown
  hisabValue?: unknown
  message: string
}

export interface QuickBooksModuleValidation {
  module: QuickBooksValidationModule
  label: string
  sourceCount: number
  importedCount: number
  matchedCount: number
  missingCount: number
  extraCount: number
  duplicateCount: number
  mismatchCount: number
  passed: boolean
  issues: QuickBooksValidationIssue[]
}

export interface QuickBooksValidationReport {
  reportVersion: 1
  provider: 'quickbooks'
  realmId: string
  generatedAt: string
  passed: boolean
  modules: QuickBooksModuleValidation[]
  totals: {
    sourceCount: number
    importedCount: number
    matchedCount: number
    issueCount: number
  }
  accounting?: import('./accounting').AccountingMaterializationValidation
}
