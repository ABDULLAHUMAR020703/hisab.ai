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

  if (options?.asOf && options.asOf.getTime() < Date.now() - 60_000) {
    const { data: movements, error: movementError } = await client
      .from('stock_movements')
      .select('inventory_item_id,warehouse_id,quantity,unit_cost,item:inventory_items(id,item_code,name,costing_method,standard_cost),warehouse:warehouses(id,name)')
      .eq('company_id', companyId)
      .lte('date', options.asOf.toISOString())
      .order('date', { ascending: true })
    if (movementError) throw movementError
    const grouped = new Map<string, ValuationRow>()
    for (const movement of movements ?? []) {
      if (options.warehouseId && movement.warehouse_id !== options.warehouseId) continue
      const key = `${movement.inventory_item_id}:${movement.warehouse_id ?? ''}`
      const itemValue = Array.isArray(movement.item) ? movement.item[0] : movement.item
      const warehouseValue = Array.isArray(movement.warehouse) ? movement.warehouse[0] : movement.warehouse
      const item = itemValue as Record<string, unknown> | null
      const warehouse = warehouseValue as Record<string, unknown> | null
      const current = grouped.get(key) ?? { inventoryItemId:String(movement.inventory_item_id),itemCode:String(item?.item_code??''),itemName:String(item?.name??''),warehouseId:String(movement.warehouse_id??''),warehouseName:String(warehouse?.name??''),costingMethod:String(item?.costing_method??'WEIGHTED_AVERAGE'),quantityOnHand:0,quantityReserved:0,quantityAvailable:0,unitCost:0,totalValue:0 }
      const quantity = Number(movement.quantity ?? 0); const unitCost = Number(movement.unit_cost ?? 0)
      current.quantityOnHand = roundCost(current.quantityOnHand + quantity)
      current.totalValue = roundCost(current.totalValue + quantity * unitCost)
      current.unitCost = Math.abs(current.quantityOnHand) > 0.0001 ? roundCost(current.totalValue / current.quantityOnHand) : 0
      current.quantityAvailable = current.quantityOnHand
      grouped.set(key,current)
    }
    const rows=[...grouped.values()].filter(row=>Math.abs(row.quantityOnHand)>0.0001||Math.abs(row.totalValue)>0.0001)
    return {asOf:options.asOf.toISOString(),rows,summary:{itemCount:rows.length,totalQuantity:roundCost(rows.reduce((sum,row)=>sum+row.quantityOnHand,0)),totalValue:roundCost(rows.reduce((sum,row)=>sum+row.totalValue,0))}}
  }

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
