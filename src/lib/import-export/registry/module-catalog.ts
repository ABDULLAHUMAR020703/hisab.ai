/** Client-safe module catalog — keep in sync when registering new modules. */
export const MODULE_CATALOG = [
  { key: 'customers', displayName: 'Customers' },
  { key: 'vendors', displayName: 'Vendors' },
  { key: 'inventory', displayName: 'Inventory' },
  { key: 'accounts', displayName: 'Chart of Accounts' },
  { key: 'cost-centers', displayName: 'Cost Centers' },
  { key: 'employees', displayName: 'Employees' },
  { key: 'tax-rates', displayName: 'Tax Rates' },
] as const

export type RegisteredModuleKey = (typeof MODULE_CATALOG)[number]['key']

export function getModuleDisplayName(moduleKey: string): string {
  const entry = MODULE_CATALOG.find((item) => item.key === moduleKey)
  return entry?.displayName ?? moduleKey
}
