import { extractProductCatalog } from '../product-catalog'
import { normalizeCostCenterNameKey } from './constants'

/** Future-ready import strategies. Default is upsert (update + create). */
export type ProjectImportMode = 'upsert' | 'create_only' | 'replace_all'

export interface ProjectMatchCandidate {
  id: string
  name: string
  metadata?: Record<string, unknown> | null
}

/**
 * Stable match key for Product/Service rows.
 * Prefer SKU when present; otherwise full product name (case-insensitive).
 */
export function projectImportMatchKey(input: {
  name: string
  sku?: string | null
}): { kind: 'sku' | 'name'; key: string } {
  const sku = String(input.sku ?? '').trim()
  if (sku) {
    return { kind: 'sku', key: `sku:${sku.toLowerCase()}` }
  }
  return { kind: 'name', key: `name:${normalizeCostCenterNameKey(input.name)}` }
}

export function skuFromProductFields(fields: Record<string, string>): string | null {
  const sku = String(fields['SKU'] ?? fields['sku'] ?? '').trim()
  return sku || null
}

export function skuFromProjectRecord(record: ProjectMatchCandidate): string | null {
  const catalog = extractProductCatalog(record.metadata ?? {})
  if (catalog.sku?.trim()) return catalog.sku.trim()
  const meta = record.metadata ?? {}
  const raw = meta['SKU'] ?? meta['sku']
  const sku = String(raw ?? '').trim()
  return sku || null
}

/**
 * Find an existing PROJECT by SKU (preferred) then by name.
 * Does not mutate; preserves ID when caller updates the returned record.
 */
export function findExistingProject(
  candidates: ProjectMatchCandidate[],
  input: { name: string; sku?: string | null },
): ProjectMatchCandidate | null {
  const sku = String(input.sku ?? '').trim()
  if (sku) {
    const skuKey = sku.toLowerCase()
    const bySku = candidates.find((c) => {
      const existingSku = skuFromProjectRecord(c)
      return existingSku != null && existingSku.toLowerCase() === skuKey
    })
    if (bySku) return bySku
  }

  const nameKey = normalizeCostCenterNameKey(input.name)
  return (
    candidates.find((c) => normalizeCostCenterNameKey(c.name) === nameKey) ?? null
  )
}
