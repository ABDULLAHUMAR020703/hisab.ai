/** Exact Product/Service spreadsheet headers — do not rename or reorder. */
export const PROJECT_PRODUCT_SERVICE_HEADERS = [
  'Product/Service Name',
  'Quantity',
  'Item Type',
  'Category',
  'SKU',
  'Purchase',
  'Sales Price',
  'Price',
  'Cost',
  'Income Account',
  'Expense Account',
  'Inventory Asset Account',
  'Sales Description',
  'Purchase Description',
  'Reorder Point',
  'Preferred Supplier',
] as const

export type ProjectProductServiceHeader = (typeof PROJECT_PRODUCT_SERVICE_HEADERS)[number]

export const LOCATION_LIST_TITLE = 'Location List'
export const LOCATION_COLUMN_HEADER = 'Location full name'

export const CLASS_LIST_TITLE = 'Class List'
export const CLASS_COLUMN_HEADER = 'Class full name'

export const COMPANY_HEADER_PLACEHOLDER = 'YOUR COMPANY NAME'

/** Titles / column headers that are never imported as data rows. */
export const VERTICAL_SKIP_LABELS = new Set([
  LOCATION_LIST_TITLE.toLowerCase(),
  LOCATION_COLUMN_HEADER.toLowerCase(),
  CLASS_LIST_TITLE.toLowerCase(),
  CLASS_COLUMN_HEADER.toLowerCase(),
  'location list',
  'class list',
  'location full name',
  'class full name',
])

/**
 * Stable short fingerprint of the full name (case-insensitive).
 * Ensures codes stay unique when readable slugs share a long common prefix
 * (e.g. MW/WL:Tiger Project:Tiger Team A vs …Team B).
 * Never splits on ":" — the entire string is hashed.
 */
export function costCenterNameFingerprint(name: string): string {
  const input = name.trim().toLowerCase()
  let hash = 2166136261
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36).toUpperCase().padStart(6, '0').slice(0, 6)
}

/**
 * Build a unique Cost Center code from the complete name.
 * Does not split hierarchical "Parent:Child" paths — uniqueness follows the full value.
 */
export function slugifyCostCenterCode(name: string, prefix: string): string {
  const trimmed = name.trim()
  const slug = trimmed
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const fingerprint = costCenterNameFingerprint(trimmed)
  // Readable stem + fingerprint of the FULL name so truncated prefixes cannot collide
  const stem = (slug || 'ITEM').slice(0, 40)
  return `${prefix}-${stem}-${fingerprint}`
}

/** Normalize a cost-center name for duplicate comparison (full string, case-insensitive). */
export function normalizeCostCenterNameKey(name: string): string {
  return name.trim().toLowerCase()
}
