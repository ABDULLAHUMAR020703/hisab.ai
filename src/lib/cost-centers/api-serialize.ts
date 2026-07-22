import type { CostCenterRecord } from '@/lib/db/entities'
import {
  buildProductServiceMetadata,
  extractProductCatalog,
  extractProductCost,
  parseMoneyValue,
} from '@/lib/cost-centers/product-catalog'

/** API DTO with top-level `cost` for PROJECT catalog visibility. */
export function serializeCostCenter(
  center: CostCenterRecord,
  options?: { includeMetadata?: boolean },
) {
  const isProject = center.type === 'PROJECT'
  const catalog = isProject ? extractProductCatalog(center.metadata) : null

  return {
    id: center.id,
    code: center.code,
    name: center.name,
    type: center.type,
    description: center.description,
    isActive: center.isActive,
    cost: isProject ? extractProductCost(center.metadata) : null,
    salesPrice: isProject ? catalog?.salesPrice ?? null : null,
    sku: isProject ? catalog?.sku ?? null : null,
    createdAt: center.createdAt,
    updatedAt: center.updatedAt,
    ...(options?.includeMetadata ? { metadata: center.metadata } : {}),
  }
}

/**
 * Merge an editable Cost into PROJECT metadata while preserving other catalog fields.
 */
export function mergeProjectCostIntoMetadata(
  existing: Record<string, unknown> | null | undefined,
  costInput: unknown,
): Record<string, unknown> {
  const base = { ...(existing ?? {}) }
  const cost = parseMoneyValue(costInput)

  if (cost == null) {
    delete base.Cost
    delete base.cost
    const catalog = extractProductCatalog(base)
    base.catalog = { ...catalog, cost: null }
    return base
  }

  base.Cost = String(cost)
  const asFields: Record<string, string> = {}
  for (const [key, value] of Object.entries(base)) {
    if (key === 'catalog') continue
    if (value == null) continue
    if (typeof value === 'object') continue
    asFields[key] = String(value)
  }
  asFields.Cost = String(cost)
  if (!asFields['Product/Service Name'] && typeof base.name === 'string') {
    asFields['Product/Service Name'] = base.name
  }

  return {
    ...base,
    ...buildProductServiceMetadata(asFields),
    Cost: String(cost),
  }
}
