const ORDER: Record<string, number> = {
  accounts:10,
  customers:20, vendors:20, items:20, 'tax-codes':20, 'payment-terms':20,
  projects:25, classes:25, departments:25, employees:25, 'tax-agencies':25, 'tax-configurations':26,
  'inventory-adjustments':27,
  bills:28,
  invoices:30, expenses:30, 'journal-entries':30, 'sales-receipts':30, 'purchase-orders':30, 'vendor-credits':30, estimates:30,
  'exchange-rates':35,
  'credit-memos':38, 'customer-payments':40, 'vendor-payments':40,
  deposits:50, transfers:50, attachments:60,
}

/**
 * Resource-level prerequisites used by the durable scheduler. These are kept
 * beside the adapter resource keys because the dependency is about source
 * extraction/materialization order, not the local module implementation name.
 * A missing resource is intentionally ignored by the scheduler, allowing a
 * migration that selected a subset of resources to proceed.
 */
export const QUICKBOOKS_MIGRATION_DEPENDENCIES: Readonly<Record<string, readonly string[]>> = {
  accounts: ['preferences'],
  'tax-codes': ['preferences'],
  'tax-agencies': ['tax-codes'],
  'tax-configurations': ['tax-codes'],
  customers: ['accounts', 'tax-codes', 'payment-terms'],
  vendors: ['accounts', 'tax-codes', 'payment-terms'],
  items: ['accounts', 'tax-codes'],
  projects: ['customers'],
  invoices: ['accounts', 'customers', 'items', 'tax-codes', 'payment-terms'],
  bills: ['accounts', 'vendors', 'items', 'tax-codes', 'payment-terms'],
  expenses: ['accounts', 'vendors', 'items', 'tax-codes'],
  'journal-entries': ['accounts', 'tax-codes'],
  'sales-receipts': ['accounts', 'customers', 'items', 'tax-codes'],
  'purchase-orders': ['accounts', 'vendors', 'items', 'tax-codes'],
  'vendor-credits': ['accounts', 'vendors', 'items', 'tax-codes'],
  estimates: ['accounts', 'customers', 'items', 'tax-codes'],
  'customer-payments': ['customers', 'invoices'],
  'vendor-payments': ['vendors', 'bills', 'vendor-credits'],
  'credit-memos': ['accounts', 'customers', 'items', 'invoices'],
  deposits: ['accounts', 'customer-payments', 'vendor-payments'],
  transfers: ['accounts'],
  'inventory-adjustments': ['accounts', 'items'],
  'time-activities': ['employees', 'customers', 'projects'],
  attachments: [],
  'recurring-transactions': ['accounts', 'customers', 'vendors', 'items'],
  'exchange-rates': ['preferences'],
  'fixed-assets': ['accounts'],
  budgets: ['accounts'],
  classes: [],
  departments: [],
  employees: [],
  'payment-terms': ['preferences'],
}

export function quickBooksMigrationDependencies(resourceKey: string): readonly string[] {
  return QUICKBOOKS_MIGRATION_DEPENDENCIES[resourceKey] ?? []
}

export function quickBooksResourceDependenciesCompleted(
  resourceKey: string,
  selectedKeys: ReadonlySet<string>,
  completedKeys: ReadonlySet<string>,
): boolean {
  return quickBooksMigrationDependencies(resourceKey)
    .filter((dependency) => selectedKeys.has(dependency))
    .every((dependency) => completedKeys.has(dependency))
}

export function orderQuickBooksMigrationResources<T extends { key: string }>(resources: T[]): T[] {
  const byKey = new Map(resources.map((resource) => [resource.key, resource]))
  const originalIndex = new Map(resources.map((resource, index) => [resource.key, index]))
  const visited = new Set<string>()
  const visiting = new Set<string>()
  const ordered: T[] = []

  const visit = (key: string) => {
    if (!byKey.has(key) || visited.has(key)) return
    if (visiting.has(key)) throw new Error(`QuickBooks migration dependency cycle includes ${key}.`)
    visiting.add(key)
    for (const dependency of quickBooksMigrationDependencies(key)) visit(dependency)
    visiting.delete(key)
    visited.add(key)
    ordered.push(byKey.get(key)!)
  }

  [...resources]
    .sort((left, right) => (ORDER[left.key] ?? 35) - (ORDER[right.key] ?? 35) || (originalIndex.get(left.key) ?? 0) - (originalIndex.get(right.key) ?? 0))
    .forEach((resource) => visit(resource.key))
  return ordered
}
