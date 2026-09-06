/**
 * The QuickBooks snapshot resource inventory, derived from the live provider
 * implementation (`quickbooks.adapter.ts` + `QuickBooksIntegrationService`).
 *
 * Every entry here is something the extractor knows how to pull as raw QBO JSON.
 * `tier` drives whether a `failed`/`unsupported` result blocks snapshot COMPLETE.
 */
import {
  PARTITIONED_RESOURCES,
  QUICKBOOKS_ENTITY_BY_RESOURCE,
  RESOURCES,
} from '@/lib/import-export/sources/quickbooks.adapter'

export type SnapshotResourceTier = 'required-core' | 'required-transactional' | 'optional'

/** How the extractor sources this resource's raw rows. */
export type SnapshotResourceMode =
  | 'query' // SELECT * FROM <entity> [WHERE <where>], standard STARTPOSITION pagination
  | 'query-partitioned' // date-windowed transaction query (provider `partitioned: true`)
  | 'preferences' // provider.getPreferences() — single object
  | 'exchange-rates' // provider.getEntityRecords('ExchangeRate', { where }) with resolved currency pairs
  | 'attachments' // Attachable metadata pages + binary downloads

export interface SnapshotResourceSpec {
  resourceKey: string
  entity: string
  label: string
  tier: SnapshotResourceTier
  mode: SnapshotResourceMode
  /** Provider WHERE predicate (without the `Active IN (...)` clause the provider adds). */
  where?: string
  includeInactive?: boolean
}

/** HTTP statuses that mean "this company / edition does not expose the entity". */
export const UNSUPPORTED_HTTP_STATUSES = new Set([400, 404, 405, 501])

const CORE: Array<[string, string, SnapshotResourceSpec['mode'], boolean?]> = [
  ['accounts', 'Account', 'query', true],
  ['customers', 'Customer', 'query', true],
  ['vendors', 'Vendor', 'query', true],
  ['items', 'Item', 'query', true],
  ['tax-codes', 'TaxRate', 'query'],
  ['tax-configurations', 'TaxCode', 'query'],
  ['payment-terms', 'Term', 'query', true],
]

const TRANSACTIONAL: Array<[string, string]> = [
  ['invoices', 'Invoice'],
  ['bills', 'Bill'],
  ['expenses', 'Purchase'],
  ['journal-entries', 'JournalEntry'],
  ['sales-receipts', 'SalesReceipt'],
  ['credit-memos', 'CreditMemo'],
  ['vendor-credits', 'VendorCredit'],
  ['customer-payments', 'Payment'],
  ['vendor-payments', 'BillPayment'],
  ['deposits', 'Deposit'],
  ['transfers', 'Transfer'],
  ['purchase-orders', 'PurchaseOrder'],
  ['estimates', 'Estimate'],
]

const OPTIONAL: Array<[string, string, SnapshotResourceSpec['mode'], string?]> = [
  ['preferences', 'Preferences', 'preferences'],
  ['classes', 'Class', 'query'],
  ['departments', 'Department', 'query'],
  ['employees', 'Employee', 'query'],
  ['payment-methods', 'PaymentMethod', 'query'],
  ['tax-agencies', 'TaxAgency', 'query'],
  ['exchange-rates', 'ExchangeRate', 'exchange-rates'],
  ['budgets', 'Budget', 'query'],
  ['time-activities', 'TimeActivity', 'query-partitioned'],
  ['inventory-adjustments', 'InventoryAdjustment', 'query-partitioned'],
  ['recurring-transactions', 'RecurringTransaction', 'query'],
  ['projects', 'Customer', 'query', 'Job = true'],
  ['fixed-assets', 'Item', 'query', "Type = 'FixedAsset'"],
  ['attachments', 'Attachable', 'attachments'],
]

function build(): SnapshotResourceSpec[] {
  const specs: SnapshotResourceSpec[] = []
  const labelFor = (key: string) => RESOURCES.find((r) => r.key === key)?.label ?? key

  for (const [resourceKey, entity, mode, includeInactive] of CORE) {
    specs.push({ resourceKey, entity, label: labelFor(resourceKey), tier: 'required-core', mode, includeInactive })
  }
  for (const [resourceKey, entity] of TRANSACTIONAL) {
    const mode: SnapshotResourceMode = PARTITIONED_RESOURCES.has(resourceKey) ? 'query-partitioned' : 'query'
    specs.push({ resourceKey, entity, label: labelFor(resourceKey), tier: 'required-transactional', mode })
  }
  for (const [resourceKey, entity, mode, where] of OPTIONAL) {
    specs.push({ resourceKey, entity, label: labelFor(resourceKey), tier: 'optional', mode, where })
  }
  return specs
}

export const SNAPSHOT_RESOURCES: SnapshotResourceSpec[] = build()

const BY_KEY = new Map(SNAPSHOT_RESOURCES.map((spec) => [spec.resourceKey, spec]))

export function getSnapshotResourceSpec(resourceKey: string): SnapshotResourceSpec | undefined {
  return BY_KEY.get(resourceKey)
}

export function requiredSnapshotResourceKeys(requested?: readonly string[]): string[] {
  const pool = requested?.length
    ? SNAPSHOT_RESOURCES.filter((spec) => requested.includes(spec.resourceKey))
    : SNAPSHOT_RESOURCES
  return pool.filter((spec) => spec.tier !== 'optional').map((spec) => spec.resourceKey)
}

export function allSnapshotResourceKeys(): string[] {
  return SNAPSHOT_RESOURCES.map((spec) => spec.resourceKey)
}

/** Sanity check: every spec entity matches the adapter's own entity map where it has one. */
export function assertResourceInventoryConsistency(): void {
  for (const spec of SNAPSHOT_RESOURCES) {
    const adapterEntity = QUICKBOOKS_ENTITY_BY_RESOURCE[spec.resourceKey]
    if (adapterEntity && adapterEntity !== spec.entity) {
      throw new Error(
        `snapshot-resources: ${spec.resourceKey} entity ${spec.entity} disagrees with adapter ${adapterEntity}`,
      )
    }
  }
}
