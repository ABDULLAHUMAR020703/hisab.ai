/** Client-safe module catalog — keep in sync when registering new modules. */
export const MODULE_CATALOG = [
  { key: 'customers', displayName: 'Customers' },
  { key: 'vendors', displayName: 'Vendors' },
  { key: 'inventory', displayName: 'Inventory' },
  { key: 'accounts', displayName: 'Chart of Accounts' },
  { key: 'cost-centers', displayName: 'Cost Centers' },
  { key: 'employees', displayName: 'Employees' },
  { key: 'tax-rates', displayName: 'Tax Rates' },
  { key: 'payment-terms', displayName: 'Payment Terms' },
  { key: 'invoices', displayName: 'Invoices' },
  { key: 'bills', displayName: 'Bills' },
  { key: 'expenses', displayName: 'Expenses' },
  { key: 'journal-entries', displayName: 'Journal Entries' },
  { key: 'sales-receipts', displayName: 'Sales Receipts' },
  { key: 'purchase-orders', displayName: 'Purchase Orders' },
  { key: 'vendor-credits', displayName: 'Supplier Credits' },
  { key: 'estimates', displayName: 'Estimates' },
  { key: 'customer-payments', displayName: 'Customer Payments' },
  { key: 'vendor-payments', displayName: 'Vendor Payments' },
  { key: 'qb-projects', displayName: 'QuickBooks Projects' },
  { key: 'qb-budgets', displayName: 'QuickBooks Budgets' },
  { key: 'qb-exchange-rates', displayName: 'QuickBooks Exchange Rates' },
  { key: 'qb-classes', displayName: 'QuickBooks Classes' },
  { key: 'qb-departments', displayName: 'QuickBooks Departments' },
  { key: 'qb-locations', displayName: 'QuickBooks Locations' },
  { key: 'qb-employees', displayName: 'QuickBooks Employees' },
  { key: 'qb-time-activities', displayName: 'QuickBooks Time Activities' },
  { key: 'qb-credit-memos', displayName: 'QuickBooks Credit Memos' },
  { key: 'qb-bill-payments', displayName: 'QuickBooks Bill Payments' },
  { key: 'qb-deposits', displayName: 'QuickBooks Deposits' },
  { key: 'qb-transfers', displayName: 'QuickBooks Transfers' },
  { key: 'qb-inventory-adjustments', displayName: 'QuickBooks Inventory Adjustments' },
  { key: 'qb-attachments', displayName: 'QuickBooks Attachments' },
  { key: 'qb-recurring-transactions', displayName: 'QuickBooks Recurring Transactions' },
  { key: 'qb-tax-agencies', displayName: 'QuickBooks Tax Agencies' },
  { key: 'qb-tax-configurations', displayName: 'QuickBooks Tax Configuration' },
  { key: 'qb-preferences', displayName: 'QuickBooks Company Preferences' },
  { key: 'qb-fixed-assets', displayName: 'QuickBooks Fixed Assets' },
] as const

export type RegisteredModuleKey = (typeof MODULE_CATALOG)[number]['key']

export function getModuleDisplayName(moduleKey: string): string {
  const entry = MODULE_CATALOG.find((item) => item.key === moduleKey)
  return entry?.displayName ?? moduleKey
}
