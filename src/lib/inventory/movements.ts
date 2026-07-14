import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCompanyId } from '@/lib/tenant'
import { getNextSequence } from '@/lib/sequences'
import {
  assertNonNegativeStock,
  calculateAvailableQuantity,
  calculateValuation,
  calculateWeightedAverageCost,
  consumeFifoLayers,
  calculateStandardIssueCost,
  roundCost,
  roundQty,
  type CostLayer,
  type InventoryCostingMethod,
  type InventoryMovementType,
} from './costing'
import { logInventoryAudit } from './audit'
import { postInventoryCostingJournal } from './journal-posting'

export class InventoryError extends Error {
  constructor(message: string, public code: string) {
    super(message)
    this.name = 'InventoryError'
  }
}

interface ItemConfig {
  id: string
  costingMethod: InventoryCostingMethod
  standardCost: number
  allowNegativeStock: boolean
  trackLots: boolean
  trackSerials: boolean
  costPrice: number
}

async function loadItem(client: ReturnType<typeof createAdminClient>, itemId: string, companyId: string): Promise<ItemConfig> {
  const { data, error } = await client
    .from('inventory_items')
    .select('id, costing_method, standard_cost, allow_negative_stock, track_lots, track_serials, cost_price')
    .eq('id', itemId)
    .eq('company_id', companyId)
    .is('deleted_at', null)
    .single()

  if (error || !data) throw new InventoryError('Inventory item not found', 'ITEM_NOT_FOUND')

  return {
    id: String(data.id),
    costingMethod: (data.costing_method as InventoryCostingMethod) ?? 'WEIGHTED_AVERAGE',
    standardCost: Number(data.standard_cost ?? data.cost_price ?? 0),
    allowNegativeStock: Boolean(data.allow_negative_stock),
    trackLots: Boolean(data.track_lots),
    trackSerials: Boolean(data.track_serials),
    costPrice: Number(data.cost_price ?? 0),
  }
}

async function getOrCreateWarehouseStock(
  client: ReturnType<typeof createAdminClient>,
  companyId: string,
  itemId: string,
  warehouseId: string,
) {
  const { data: existing } = await client
    .from('warehouse_stock')
    .select('*')
    .eq('company_id', companyId)
    .eq('inventory_item_id', itemId)
    .eq('warehouse_id', warehouseId)
    .maybeSingle()

  if (existing) return existing

  const { data: created, error } = await client
    .from('warehouse_stock')
    .insert({
      company_id: companyId,
      inventory_item_id: itemId,
      warehouse_id: warehouseId,
      quantity_on_hand: 0,
      quantity_reserved: 0,
      average_cost: 0,
      total_value: 0,
    })
    .select('*')
    .single()

  if (error) throw error
  return created
}

async function syncItemTotalQuantity(client: ReturnType<typeof createAdminClient>, companyId: string, itemId: string) {
  const { data: rows } = await client
    .from('warehouse_stock')
    .select('quantity_on_hand')
    .eq('company_id', companyId)
    .eq('inventory_item_id', itemId)

  const total = (rows ?? []).reduce((s, r) => s + Number(r.quantity_on_hand ?? 0), 0)
  await client
    .from('inventory_items')
    .update({ quantity: roundQty(total), updated_at: new Date().toISOString() })
    .eq('company_id', companyId)
    .eq('id', itemId)
}

async function resolveDefaultWarehouse(client: ReturnType<typeof createAdminClient>, companyId: string): Promise<string> {
  const { data, error } = await client
    .from('warehouses')
    .select('id')
    .eq('company_id', companyId)
    .eq('is_active', true)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  if (!data) throw new InventoryError('No warehouse configured', 'WAREHOUSE_NOT_FOUND')
  return String(data.id)
}

export interface MovementInput {
  inventoryItemId: string
  warehouseId?: string | null
  quantity: number
  unitCost?: number
  movementType: InventoryMovementType
  sourceType?: string | null
  sourceId?: string | null
  reference?: string | null
  lotId?: string | null
  serialId?: string | null
  batchNo?: string | null
  expiryDate?: Date | null
  companyId?: string
  userId?: string | null
  reason?: string | null
  postCogsJournal?: boolean
}

export async function processInventoryMovement(input: MovementInput): Promise<{
  movementId: string
  movementNo: string
  unitCost: number
  totalCost: number
}> {
  const companyId = input.companyId ?? await resolveCompanyId()
  const client = createAdminClient()
  const item = await loadItem(client, input.inventoryItemId, companyId)
  const warehouseId = input.warehouseId ?? await resolveDefaultWarehouse(client, companyId)
  const qty = Math.abs(Number(input.quantity))
  if (qty <= 0) throw new InventoryError('Quantity must be positive', 'INVALID_QUANTITY')

  const stock = await getOrCreateWarehouseStock(client, companyId, input.inventoryItemId, warehouseId)
  const onHand = Number(stock.quantity_on_hand ?? 0)
  const reserved = Number(stock.quantity_reserved ?? 0)
  const available = calculateAvailableQuantity(onHand, reserved)
  const beforeState = { onHand, reserved, available, averageCost: Number(stock.average_cost ?? 0) }

  const isInbound = (
    ['RECEIPT', 'TRANSFER_IN', 'GOODS_RECEIPT', 'MANUFACTURING_OUTPUT'].includes(input.movementType)
    || (input.movementType === 'ADJUSTMENT' && Number(input.quantity) > 0)
    || (input.movementType === 'COUNT_ADJUSTMENT' && Number(input.quantity) > 0)
  )
  const isOutbound = ['ISSUE', 'TRANSFER_OUT', 'GOODS_ISSUE', 'MANUFACTURING_CONSUMPTION'].includes(input.movementType)
    || (input.movementType === 'ADJUSTMENT' && Number(input.quantity) < 0)
    || (input.movementType === 'COUNT_ADJUSTMENT' && Number(input.quantity) < 0)

  let unitCost = Number(input.unitCost ?? stock.average_cost ?? item.costPrice ?? 0)
  let totalCost = 0
  let newOnHand = onHand
  let newAvgCost = Number(stock.average_cost ?? item.costPrice ?? 0)

  if (isOutbound) {
    assertNonNegativeStock(available, qty, item.allowNegativeStock)

    if (item.costingMethod === 'FIFO') {
      const { data: layerRows } = await client
        .from('inventory_cost_layers')
        .select('id, quantity_remaining, unit_cost, received_at')
        .eq('company_id', companyId)
        .eq('inventory_item_id', input.inventoryItemId)
        .eq('warehouse_id', warehouseId)
        .gt('quantity_remaining', 0)
        .order('received_at', { ascending: true })

      const layers: CostLayer[] = (layerRows ?? []).map((l) => ({
        id: String(l.id),
        quantityRemaining: Number(l.quantity_remaining),
        unitCost: Number(l.unit_cost),
        receivedAt: new Date(String(l.received_at)),
      }))

      try {
        const issue = consumeFifoLayers(layers, qty)
        unitCost = issue.unitCost
        totalCost = issue.totalCost
        for (const consumed of issue.consumedLayers) {
          if (!consumed.layerId) continue
          const layer = layers.find((l) => l.id === consumed.layerId)
          if (!layer) continue
          await client
            .from('inventory_cost_layers')
            .update({ quantity_remaining: roundQty(layer.quantityRemaining - consumed.quantity) })
            .eq('id', consumed.layerId)
        }
      } catch {
        if (!item.allowNegativeStock) throw new InventoryError('Insufficient FIFO layers', 'INSUFFICIENT_STOCK')
        totalCost = roundCost(qty * unitCost)
      }
    } else if (item.costingMethod === 'STANDARD') {
      const issue = calculateStandardIssueCost(qty, item.standardCost)
      unitCost = issue.unitCost
      totalCost = issue.totalCost
    } else {
      unitCost = newAvgCost || item.costPrice
      totalCost = roundCost(qty * unitCost)
    }

    newOnHand = roundQty(onHand - qty)
  } else if (isInbound || input.movementType === 'COUNT_ADJUSTMENT') {
    const receiptQty = input.movementType === 'ADJUSTMENT' ? Number(input.quantity) : qty
    unitCost = Number(input.unitCost ?? item.standardCost ?? item.costPrice ?? 0)

    if (item.costingMethod === 'WEIGHTED_AVERAGE') {
      newAvgCost = calculateWeightedAverageCost(onHand, newAvgCost, receiptQty, unitCost)
    } else if (item.costingMethod === 'FIFO') {
      newAvgCost = unitCost
    } else {
      newAvgCost = item.standardCost || unitCost
    }

    totalCost = roundCost(receiptQty * unitCost)
    newOnHand = roundQty(onHand + receiptQty)
  }

  const movementNo = await getNextSequence('STOCK_MOVEMENT', 'SM-')
  const signedQty = isOutbound ? -qty : (input.movementType === 'ADJUSTMENT' || input.movementType === 'COUNT_ADJUSTMENT'
    ? Number(input.quantity)
    : qty)

  const { data: movement, error: movError } = await client
    .from('stock_movements')
    .insert({
      company_id: companyId,
      movement_no: movementNo,
      inventory_item_id: input.inventoryItemId,
      warehouse_id: warehouseId,
      movement_type: input.movementType,
      quantity: signedQty,
      unit_cost: unitCost,
      total_cost: totalCost,
      reference: input.reference ?? null,
      source_type: input.sourceType ?? null,
      source_id: input.sourceId ?? null,
      lot_id: input.lotId ?? null,
      serial_id: input.serialId ?? null,
      batch_no: input.batchNo ?? null,
      expiry_date: input.expiryDate?.toISOString() ?? null,
      created_by_id: input.userId ?? null,
      date: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (movError) throw movError

  if (isInbound && item.costingMethod === 'FIFO') {
    const receiptQty = input.movementType === 'ADJUSTMENT' || input.movementType === 'COUNT_ADJUSTMENT'
      ? Number(input.quantity)
      : qty
    await client.from('inventory_cost_layers').insert({
      company_id: companyId,
      inventory_item_id: input.inventoryItemId,
      warehouse_id: warehouseId,
      lot_id: input.lotId ?? null,
      quantity_remaining: receiptQty,
      unit_cost: unitCost,
      source_movement_id: movement.id,
    })
  }

  const totalValue = calculateValuation(newOnHand, newAvgCost)
  await client
    .from('warehouse_stock')
    .update({
      quantity_on_hand: newOnHand,
      average_cost: newAvgCost,
      total_value: totalValue,
      updated_at: new Date().toISOString(),
    })
    .eq('company_id', companyId)
    .eq('inventory_item_id', input.inventoryItemId)
    .eq('warehouse_id', warehouseId)

  await syncItemTotalQuantity(client, companyId, input.inventoryItemId)

  await logInventoryAudit({
    companyId,
    action: input.movementType,
    entityType: 'stock_movement',
    entityId: String(movement.id),
    inventoryItemId: input.inventoryItemId,
    warehouseId,
    userId: input.userId,
    reason: input.reason,
    beforeState,
    afterState: { onHand: newOnHand, averageCost: newAvgCost, totalValue, unitCost, totalCost },
  })

  if (isOutbound && input.postCogsJournal !== false && totalCost > 0) {
    await postInventoryCostingJournal({
      companyId,
      inventoryItemId: input.inventoryItemId,
      sourceId: String(movement.id),
      cogsAmount: totalCost,
      description: `${input.movementType} ${movementNo}`,
      entryDate: new Date(),
      userId: input.userId,
    })
  }

  return {
    movementId: String(movement.id),
    movementNo,
    unitCost,
    totalCost,
  }
}

export async function processWarehouseTransfer(input: {
  inventoryItemId: string
  fromWarehouseId: string
  toWarehouseId: string
  quantity: number
  unitCost?: number
  companyId?: string
  userId?: string | null
  reference?: string
}) {
  const companyId = input.companyId ?? await resolveCompanyId()
  const issue = await processInventoryMovement({
    companyId,
    inventoryItemId: input.inventoryItemId,
    warehouseId: input.fromWarehouseId,
    quantity: input.quantity,
    unitCost: input.unitCost,
    movementType: 'TRANSFER_OUT',
    reference: input.reference ?? `Transfer to ${input.toWarehouseId}`,
    userId: input.userId,
    postCogsJournal: false,
  })

  await processInventoryMovement({
    companyId,
    inventoryItemId: input.inventoryItemId,
    warehouseId: input.toWarehouseId,
    quantity: input.quantity,
    unitCost: issue.unitCost,
    movementType: 'TRANSFER_IN',
    reference: input.reference ?? `Transfer from ${input.fromWarehouseId}`,
    userId: input.userId,
    postCogsJournal: false,
  })

  return issue
}
