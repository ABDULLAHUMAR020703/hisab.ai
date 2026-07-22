/**
 * Product/Service catalog helpers for PROJECT cost centers.
 * Spreadsheet columns live in `metadata`; canonical `catalog` fields support invoices and future modules.
 */

export interface ProductCatalogFields {
  name: string
  sku: string | null
  category: string | null
  /** Default unit cost from the Product/Service sheet "Cost" column. */
  cost: number | null
  /** Prefer Sales Price, then Price — for quotes/sales later. */
  salesPrice: number | null
  incomeAccount: string | null
  expenseAccount: string | null
  inventoryAssetAccount: string | null
  salesDescription: string | null
  purchaseDescription: string | null
  quantity: number | null
  itemType: string | null
  reorderPoint: number | null
  preferredSupplier: string | null
}

function asTrimmedString(value: unknown): string {
  if (value == null) return ''
  return String(value).trim()
}

/**
 * Parse spreadsheet / JSON money values ("100", "100.00", "SAR 100", 100).
 * Returns null when empty or not numeric.
 */
export function parseMoneyValue(value: unknown): number | null {
  if (value == null) return null
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  const text = String(value).trim()
  if (!text) return null
  const cleaned = text.replace(/[^0-9.\-]/g, '')
  if (!cleaned || cleaned === '-' || cleaned === '.') return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

function fieldFromRecord(fields: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (key in fields && fields[key] != null && String(fields[key]).trim() !== '') {
      return fields[key]
    }
  }
  // Case-insensitive fallback
  const lowerMap = new Map(
    Object.entries(fields).map(([k, v]) => [k.trim().toLowerCase(), v]),
  )
  for (const key of keys) {
    const hit = lowerMap.get(key.toLowerCase())
    if (hit != null && String(hit).trim() !== '') return hit
  }
  return undefined
}

/** Build canonical catalog + preserve original spreadsheet columns. */
export function buildProductServiceMetadata(
  fields: Record<string, string>,
): Record<string, unknown> {
  const catalog = extractProductCatalog(fields)
  return {
    ...fields,
    catalog,
  }
}

export function extractProductCatalog(
  metadata: Record<string, unknown> | null | undefined,
): ProductCatalogFields {
  const meta = metadata ?? {}
  const nested =
    meta.catalog && typeof meta.catalog === 'object' && !Array.isArray(meta.catalog)
      ? (meta.catalog as Record<string, unknown>)
      : null

  const source = nested ?? meta

  const salesPrice =
    parseMoneyValue(fieldFromRecord(source, 'salesPrice', 'Sales Price')) ??
    parseMoneyValue(fieldFromRecord(source, 'Price', 'price'))

  const cost =
    parseMoneyValue(fieldFromRecord(source, 'cost', 'Cost')) ??
    parseMoneyValue(fieldFromRecord(meta, 'Cost', 'cost'))

  return {
    name: asTrimmedString(
      fieldFromRecord(source, 'name', 'Product/Service Name') ||
        fieldFromRecord(meta, 'Product/Service Name'),
    ),
    sku: asTrimmedString(fieldFromRecord(source, 'sku', 'SKU')) || null,
    category: asTrimmedString(fieldFromRecord(source, 'category', 'Category')) || null,
    cost,
    salesPrice,
    incomeAccount:
      asTrimmedString(fieldFromRecord(source, 'incomeAccount', 'Income Account')) || null,
    expenseAccount:
      asTrimmedString(fieldFromRecord(source, 'expenseAccount', 'Expense Account')) || null,
    inventoryAssetAccount:
      asTrimmedString(
        fieldFromRecord(source, 'inventoryAssetAccount', 'Inventory Asset Account'),
      ) || null,
    salesDescription:
      asTrimmedString(fieldFromRecord(source, 'salesDescription', 'Sales Description')) || null,
    purchaseDescription:
      asTrimmedString(
        fieldFromRecord(source, 'purchaseDescription', 'Purchase Description'),
      ) || null,
    quantity: parseMoneyValue(fieldFromRecord(source, 'quantity', 'Quantity')),
    itemType: asTrimmedString(fieldFromRecord(source, 'itemType', 'Item Type')) || null,
    reorderPoint: parseMoneyValue(fieldFromRecord(source, 'reorderPoint', 'Reorder Point')),
    preferredSupplier:
      asTrimmedString(fieldFromRecord(source, 'preferredSupplier', 'Preferred Supplier')) ||
      null,
  }
}

/** Default unit price for invoice lines — uses imported Cost. */
export function extractProductCost(
  metadata: Record<string, unknown> | null | undefined,
): number | null {
  return extractProductCatalog(metadata).cost
}

/** Unit price to apply on Project/Service selection (0 when cost is missing). */
export function defaultUnitPriceFromProject(
  metadata: Record<string, unknown> | null | undefined,
): number {
  return extractProductCost(metadata) ?? 0
}
