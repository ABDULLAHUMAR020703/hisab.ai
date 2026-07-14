import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCompanyId } from '@/lib/tenant'
import { calculateValuation, roundCost } from './costing'

export interface ValuationRow {
  inventoryItemId: string
  itemCode: string
  itemName: string
  warehouseId: string
  warehouseName: string
  costingMethod: string
  quantityOnHand: number
  quantityReserved: number
  quantityAvailable: number
  unitCost: number
  totalValue: number
}

export async function buildInventoryValuationReport(options?: {
  companyId?: string
  warehouseId?: string
  asOf?: Date
}) {
  const companyId = options?.companyId ?? await resolveCompanyId()
  const client = createAdminClient()

  let query = client
    .from('warehouse_stock')
    .select(`
      *,
      item:inventory_items(id, item_code, name, costing_method, standard_cost),
      warehouse:warehouses(id, name)
    `)
    .eq('company_id', companyId)

  if (options?.warehouseId) query = query.eq('warehouse_id', options.warehouseId)

  const { data, error } = await query
  if (error) throw error

  const rows: ValuationRow[] = (data ?? []).map((row) => {
    const onHand = Number(row.quantity_on_hand ?? 0)
    const reserved = Number(row.quantity_reserved ?? 0)
    const avgCost = Number(row.average_cost ?? 0)
    const item = row.item as Record<string, unknown> | null
    const warehouse = row.warehouse as Record<string, unknown> | null
    const costingMethod = String(item?.costing_method ?? 'WEIGHTED_AVERAGE')
    const unitCost = costingMethod === 'STANDARD'
      ? Number(item?.standard_cost ?? avgCost)
      : avgCost

    return {
      inventoryItemId: String(row.inventory_item_id),
      itemCode: String(item?.item_code ?? ''),
      itemName: String(item?.name ?? ''),
      warehouseId: String(row.warehouse_id),
      warehouseName: String(warehouse?.name ?? ''),
      costingMethod,
      quantityOnHand: onHand,
      quantityReserved: reserved,
      quantityAvailable: onHand - reserved,
      unitCost: roundCost(unitCost),
      totalValue: calculateValuation(onHand, unitCost),
    }
  })

  const totalValue = roundCost(rows.reduce((s, r) => s + r.totalValue, 0))
  const totalQuantity = roundCost(rows.reduce((s, r) => s + r.quantityOnHand, 0))

  return {
    asOf: (options?.asOf ?? new Date()).toISOString(),
    rows,
    summary: {
      itemCount: rows.length,
      totalQuantity,
      totalValue,
    },
  }
}

export async function recalculateWeightedAverageCosts(companyId?: string) {
  const cid = companyId ?? await resolveCompanyId()
  const client = createAdminClient()

  const { data: wacItems } = await client
    .from('inventory_items')
    .select('id')
    .eq('company_id', cid)
    .eq('costing_method', 'WEIGHTED_AVERAGE')
    .is('deleted_at', null)

  let updated = 0
  for (const item of wacItems ?? []) {
    const { data: stockRows } = await client
      .from('warehouse_stock')
      .select('id, quantity_on_hand, average_cost')
      .eq('company_id', cid)
      .eq('inventory_item_id', item.id)

    for (const stock of stockRows ?? []) {
      const qty = Number(stock.quantity_on_hand ?? 0)
      const avg = Number(stock.average_cost ?? 0)
      await client
        .from('warehouse_stock')
        .update({ total_value: calculateValuation(qty, avg) })
        .eq('id', stock.id)
      updated++
    }
  }

  return { updated }
}
