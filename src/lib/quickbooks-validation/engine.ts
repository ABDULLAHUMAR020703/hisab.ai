import type {
  QuickBooksModuleValidation,
  QuickBooksValidationIssue,
  QuickBooksValidationModule,
  QuickBooksValidationReport,
} from './types'

type Row = Record<string, unknown>
type FieldKind = 'text' | 'number' | 'boolean' | 'enum' | 'parent' | 'tax' | 'payment-term' | 'currency'

export interface ValidationModuleConfig {
  module: QuickBooksValidationModule
  label: string
  keyFields: string[]
  fields: Record<string, FieldKind>
  enumValues?: Record<string, readonly string[]>
}

export interface CompareModuleInput {
  config: ValidationModuleConfig
  sourceRows: Row[]
  importedRows: Row[]
  realmId: string
}

export const VALIDATION_CONFIGS: Record<QuickBooksValidationModule, ValidationModuleConfig> = {
  accounts: {
    module: 'accounts', label: 'Chart of Accounts', keyFields: ['accountNo'],
    fields: { accountNo: 'text', name: 'text', fullName: 'text', parentNo: 'parent', accountType: 'enum', subType: 'text', description: 'text', isActive: 'boolean' },
    enumValues: { accountType: ['Bank', 'Accounts Receivable', 'Other Current Asset', 'Fixed Asset', 'Other Asset', 'Accounts Payable', 'Credit Card', 'Other Current Liability', 'Long Term Liability', 'Equity', 'Income', 'Other Income', 'Cost of Goods Sold', 'Expense', 'Other Expense', 'Non-Posting'] },
  },
  customers: {
    module: 'customers', label: 'Customers', keyFields: ['name'],
    fields: { name: 'text', email: 'text', phone: 'text', address: 'text', city: 'text', country: 'text', taxId: 'tax', paymentTerms: 'payment-term', isActive: 'boolean' },
  },
  vendors: {
    module: 'vendors', label: 'Vendors', keyFields: ['name'],
    fields: { name: 'text', email: 'text', phone: 'text', address: 'text', city: 'text', country: 'text', taxId: 'tax', paymentTerms: 'payment-term', isActive: 'boolean' },
  },
  items: {
    module: 'items', label: 'Products & Services', keyFields: ['itemCode'],
    fields: { name: 'text', itemCode: 'text', description: 'text', category: 'enum', unit: 'enum', costPrice: 'number', salePrice: 'number', quantity: 'number', minQuantity: 'number', isActive: 'boolean' },
    enumValues: { category: ['Products', 'Services'], unit: ['PCS', 'SVC'] },
  },
  'tax-codes': {
    module: 'tax-codes', label: 'Tax Codes', keyFields: ['name'],
    fields: { name: 'text', rate: 'tax', type: 'enum', isDefault: 'boolean', isActive: 'boolean' },
    enumValues: { type: ['VAT'] },
  },
  'payment-terms': {
    module: 'payment-terms', label: 'Payment Terms', keyFields: ['name'],
    fields: { name: 'text', days: 'payment-term', description: 'text', isActive: 'boolean' },
  },
  invoices: transactionConfig('invoices', 'Invoices'),
  bills: transactionConfig('bills', 'Bills'),
  payments: transactionConfig('payments', 'Payments'),
  'journal-entries': transactionConfig('journal-entries', 'Journal Entries'),
  expenses: transactionConfig('expenses', 'Expenses'),
  'sales-receipts': transactionConfig('sales-receipts', 'Sales Receipts'),
  'purchase-orders': transactionConfig('purchase-orders', 'Purchase Orders'),
  'vendor-credits': transactionConfig('vendor-credits', 'Supplier Credits'),
  estimates: transactionConfig('estimates', 'Estimates'),
  'customer-payments': transactionConfig('customer-payments', 'Customer Payments'),
  'vendor-payments': transactionConfig('vendor-payments', 'Vendor Payments'),
  projects: extendedConfig('projects','Projects'), budgets:extendedConfig('budgets','Budgets'),
  'exchange-rates':extendedConfig('exchange-rates','Exchange Rates'), classes:extendedConfig('classes','Classes'),
  departments:extendedConfig('departments','Departments'), locations:extendedConfig('locations','Locations'),
  employees:extendedConfig('employees','Employees'), 'time-activities':extendedConfig('time-activities','Time Activities'),
  'credit-memos':extendedConfig('credit-memos','Credit Memos'), 'bill-payments':extendedConfig('bill-payments','Bill Payments'),
  deposits:extendedConfig('deposits','Deposits'), transfers:extendedConfig('transfers','Transfers'),
  'inventory-adjustments':extendedConfig('inventory-adjustments','Inventory Adjustments'), attachments:extendedConfig('attachments','Attachments'),
  'recurring-transactions':extendedConfig('recurring-transactions','Recurring Transactions'), 'tax-agencies':extendedConfig('tax-agencies','Tax Agencies'),
  'tax-configurations':extendedConfig('tax-configurations','Tax Configuration'), preferences:extendedConfig('preferences','Preferences'),
  'fixed-assets':extendedConfig('fixed-assets','Fixed Assets'),
}

function extendedConfig(module: QuickBooksValidationModule, label: string): ValidationModuleConfig {
  return { module, label, keyFields:['sourceId'], fields:{ _quickbooksRaw:'text' } }
}

function transactionConfig(module: QuickBooksValidationModule, label: string): ValidationModuleConfig {
  return {
    module, label, keyFields: ['transactionNo'],
    fields: {
      transactionNo: 'text', date: 'text', customerName: 'text', vendorName: 'text',
      amount: 'currency', subtotal: 'currency', taxAmount: 'tax', total: 'currency',
      currency: 'currency', status: 'enum', reference: 'text', paymentMethod: 'enum',
      relatedSourceId: 'text',
    },
    enumValues: { status: ['OPEN', 'PAID', 'PARTIALLY_PAID', 'DRAFT', 'PENDING', 'POSTED', 'VOID', 'CANCELLED', 'OVERDUE'], paymentMethod: ['CASH', 'BANK_TRANSFER', 'CARD', 'CHEQUE', 'CHECK', 'OTHER'] },
  }
}

function empty(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '')
}

function normalized(value: unknown, kind: FieldKind): unknown {
  if (empty(value)) return null
  if (kind === 'number' || kind === 'tax' || kind === 'payment-term') {
    const number = Number(typeof value === 'string' ? value.replace(/,/g, '') : value)
    return Number.isFinite(number) ? number : String(value).trim()
  }
  if (kind === 'boolean') {
    if (typeof value === 'boolean') return value
    const token = String(value).trim().toLowerCase()
    if (['true', 'yes', 'y', '1', 'active'].includes(token)) return true
    if (['false', 'no', 'n', '0', 'inactive'].includes(token)) return false
  }
  return String(value).trim()
}

function identity(row: Row, keyFields: string[]): string {
  const parts = keyFields.map((field) => normalized(row[field], 'text')).filter((value) => value !== null)
  return parts.map((part) => String(part).toLocaleLowerCase()).join(' | ')
}

function displayName(row: Row, key: string): string {
  return String(row.name ?? row.fullName ?? row.accountNo ?? row.itemCode ?? key)
}

function groups(rows: Row[], keyFields: string[]): Map<string, Row[]> {
  const result = new Map<string, Row[]>()
  for (const row of rows) {
    const key = identity(row, keyFields)
    const existing = result.get(key) ?? []
    existing.push(row)
    result.set(key, existing)
  }
  return result
}

function mismatchKind(kind: FieldKind, sourceValue: unknown, importedValue: unknown): QuickBooksValidationIssue['kind'] {
  if (!empty(sourceValue) && empty(importedValue)) return 'null_mismatch'
  if (kind === 'parent') return 'parent_mismatch'
  if (kind === 'enum') return 'invalid_enum'
  if (kind === 'tax' || kind === 'payment-term' || kind === 'currency') return 'mapping_mismatch'
  return 'field_mismatch'
}

export function compareQuickBooksModule(input: CompareModuleInput): QuickBooksModuleValidation {
  const { config, sourceRows, importedRows, realmId } = input
  const sourceGroups = groups(sourceRows, config.keyFields)
  const importedGroups = groups(importedRows, config.keyFields)
  const issues: QuickBooksValidationIssue[] = []
  let matchedCount = 0

  const issue = (row: Row, key: string, data: Omit<QuickBooksValidationIssue, 'module' | 'key' | 'recordName' | 'quickBooksId' | 'realmId'>) => {
    issues.push({
      module: config.module,
      key,
      recordName: displayName(row, key),
      quickBooksId: row._quickbooksId ? String(row._quickbooksId) : undefined,
      realmId,
      ...data,
    })
  }

  for (const [key, rows] of importedGroups) {
    if (rows.length > 1) issue(rows[0], key, { kind: 'duplicate', message: `${rows.length} duplicate Hisab AI records use key “${key}”.` })
  }

  for (const [key, rows] of sourceGroups) {
    if (!key) {
      for (const row of rows) issue(row, key, { kind: 'missing', message: `QuickBooks record has no usable ${config.keyFields.join(' or ')}.` })
      continue
    }
    if (rows.length > 1) issue(rows[0], key, { kind: 'duplicate', message: `${rows.length} duplicate QuickBooks records use key “${key}”.` })
    const imported = importedGroups.get(key)
    if (!imported?.length) {
      issue(rows[0], key, { kind: 'missing', message: 'Record exists in QuickBooks but is missing from Hisab AI.' })
      continue
    }
    const source = rows[0]
    const target = imported[0]
    let exact = true
    for (const [field, kind] of Object.entries(config.fields)) {
      const sourceValue = source[field]
      const importedValue = target[field]
      const allowed = config.enumValues?.[field]
      const invalidEnum = kind === 'enum' && allowed && !empty(importedValue) && !allowed.includes(String(importedValue))
      if (normalized(sourceValue, kind) === normalized(importedValue, kind) && !invalidEnum) continue
      exact = false
      const mismatch = invalidEnum ? 'invalid_enum' : mismatchKind(kind, sourceValue, importedValue)
      issue(source, key, {
        kind: mismatch,
        field,
        quickBooksValue: sourceValue ?? null,
        hisabValue: importedValue ?? null,
        message: invalidEnum
          ? `${field} has invalid mapped value “${String(importedValue)}”.`
          : `${field} does not match QuickBooks.`,
      })
    }
    if (['invoices', 'bills', 'payments', 'journal-entries', 'expenses'].includes(config.module)) {
      const sourceTotal = number(source.total ?? source.amount)
      const targetTotal = number(target.total ?? target.amount)
      if (sourceTotal !== null && targetTotal !== null && Math.abs(sourceTotal - targetTotal) > 0.01) {
        exact = false
        issue(source, key, { kind: 'total_mismatch', field: 'total', quickBooksValue: sourceTotal, hisabValue: targetTotal, message: 'Transaction total does not match QuickBooks.' })
      }
      const sourceTax = number(source.taxAmount)
      const targetTax = number(target.taxAmount)
      if (sourceTax !== null && targetTax !== null && Math.abs(sourceTax - targetTax) > 0.01) {
        exact = false
        issue(source, key, { kind: 'tax_mismatch', field: 'taxAmount', quickBooksValue: sourceTax, hisabValue: targetTax, message: 'Tax amount does not match QuickBooks.' })
      }
      const sourceSubtotal = number(source.subtotal)
      const targetSubtotal = number(target.subtotal)
      if (sourceSubtotal !== null && sourceTax !== null && sourceTotal !== null && Math.abs(sourceSubtotal + sourceTax - sourceTotal) > 0.01) {
        exact = false
        issue(source, key, { kind: 'tax_mismatch', field: 'total', quickBooksValue: sourceTotal, hisabValue: sourceSubtotal + sourceTax, message: 'QuickBooks subtotal plus tax does not equal its total.' })
      }
      if (targetSubtotal !== null && targetTax !== null && targetTotal !== null && Math.abs(targetSubtotal + targetTax - targetTotal) > 0.01) {
        exact = false
        issue(source, key, { kind: 'tax_mismatch', field: 'total', quickBooksValue: sourceTotal, hisabValue: targetSubtotal + targetTax, message: 'Hisab AI subtotal plus tax does not equal its total.' })
      }
      const sourceLineTotal = lineTotal(source.lines)
      const targetLineTotal = lineTotal(target.lines)
      if (sourceLineTotal !== null && targetLineTotal !== null && Math.abs(sourceLineTotal - targetLineTotal) > 0.01) {
        exact = false
        issue(source, key, { kind: 'total_mismatch', field: 'lines', quickBooksValue: sourceLineTotal, hisabValue: targetLineTotal, message: 'Line-item totals do not match QuickBooks.' })
      }
      if (!empty(source.customerName) && normalized(source.customerName, 'text') !== normalized(target.customerName, 'text')) {
        exact = false
        issue(source, key, { kind: 'relationship_mismatch', field: 'customerName', quickBooksValue: source.customerName, hisabValue: target.customerName ?? null, message: 'Customer relationship does not match QuickBooks.' })
      }
      if (!empty(source.vendorName) && normalized(source.vendorName, 'text') !== normalized(target.vendorName, 'text')) {
        exact = false
        issue(source, key, { kind: 'relationship_mismatch', field: 'vendorName', quickBooksValue: source.vendorName, hisabValue: target.vendorName ?? null, message: 'Vendor relationship does not match QuickBooks.' })
      }
    }
    if (exact) matchedCount += 1
  }

  for (const [key, rows] of importedGroups) {
    if (!sourceGroups.has(key)) issue(rows[0], key, { kind: 'extra', message: 'Record exists in Hisab AI but not in QuickBooks.' })
  }

  const count = (kind: QuickBooksValidationIssue['kind']) => issues.filter((item) => item.kind === kind).length
  const mismatchCount = issues.filter((item) => ['field_mismatch', 'parent_mismatch', 'invalid_enum', 'null_mismatch', 'mapping_mismatch', 'relationship_mismatch', 'total_mismatch', 'tax_mismatch'].includes(item.kind)).length
  return {
    module: config.module,
    label: config.label,
    sourceCount: sourceRows.length,
    importedCount: importedRows.length,
    matchedCount,
    missingCount: count('missing'),
    extraCount: count('extra'),
    duplicateCount: count('duplicate'),
    mismatchCount,
    passed: issues.length === 0 && sourceRows.length === importedRows.length,
    issues,
  }
}

function number(value: unknown): number | null {
  if (empty(value)) return null
  const parsed = Number(typeof value === 'string' ? value.replace(/,/g, '') : value)
  return Number.isFinite(parsed) ? parsed : null
}

function lineTotal(value: unknown): number | null {
  if (empty(value)) return null
  let rows: unknown = value
  if (typeof value === 'string') { try { rows = JSON.parse(value) } catch { return null } }
  if (!Array.isArray(rows)) return null
  return rows.reduce<number>((sum, row) => sum + (number((row as Row).amount) ?? number((row as Row).Amount) ?? 0), 0)
}

export function buildQuickBooksValidationReport(realmId: string, modules: QuickBooksModuleValidation[], generatedAt = new Date()): QuickBooksValidationReport {
  return {
    reportVersion: 1,
    provider: 'quickbooks',
    realmId,
    generatedAt: generatedAt.toISOString(),
    passed: modules.length > 0 && modules.every((module) => module.passed),
    modules,
    totals: {
      sourceCount: modules.reduce((sum, item) => sum + item.sourceCount, 0),
      importedCount: modules.reduce((sum, item) => sum + item.importedCount, 0),
      matchedCount: modules.reduce((sum, item) => sum + item.matchedCount, 0),
      issueCount: modules.reduce((sum, item) => sum + item.issues.length, 0),
    },
  }
}

function csvCell(value: unknown): string {
  const string = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)
  return /[",\r\n]/.test(string) ? `"${string.replace(/"/g, '""')}"` : string
}

export function validationReportToCsv(report: QuickBooksValidationReport): string {
  const header = ['module', 'status', 'issue_kind', 'record_key', 'record_name', 'field', 'quickbooks_value', 'hisab_value', 'quickbooks_id', 'realm_id', 'message']
  const rows: unknown[][] = []
  for (const moduleResult of report.modules) {
    if (moduleResult.issues.length === 0) rows.push([moduleResult.label, 'passed', '', '', '', '', '', '', '', report.realmId, `${moduleResult.matchedCount}/${moduleResult.sourceCount} matched`])
    for (const item of moduleResult.issues) rows.push([moduleResult.label, 'failed', item.kind, item.key, item.recordName, item.field, item.quickBooksValue, item.hisabValue, item.quickBooksId, item.realmId, item.message])
  }
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')
}
