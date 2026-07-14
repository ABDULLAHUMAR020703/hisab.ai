import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCompanyId } from '@/lib/tenant'
import { getNextSequence } from '@/lib/sequences'
import { assertNonNegativeStock, calculateAvailableQuantity } from './costing'
import { logInventoryAudit } from './audit'
import { InventoryError } from './movements'

export async function createInventoryReservation(input: {
  inventoryItemId: string
  warehouseId?: string | null
  quantity: number
  sourceType: string
  sourceId: string
  expiresAt?: Date | null
  notes?: string | null
  companyId?: string
  userId?: string | null
}) {
  const companyId = input.companyId ?? await resolveCompanyId()
  const client = createAdminClient()
  const qty = Number(input.quantity)
  if (qty <= 0) throw new InventoryError('Reservation quantity must be positive', 'INVALID_QUANTITY')

  let warehouseId = input.warehouseId
  if (!warehouseId) {
    const { data: wh } = await client.from('warehouses').select('id').eq('company_id', companyId).limit(1).maybeSingle()
    warehouseId = wh?.id ? String(wh.id) : null
  }
  if (!warehouseId) throw new InventoryError('Warehouse required', 'WAREHOUSE_NOT_FOUND')

  const { data: stock } = await client
    .from('warehouse_stock')
    .select('quantity_on_hand, quantity_reserved')
    .eq('company_id', companyId)
    .eq('inventory_item_id', input.inventoryItemId)
    .eq('warehouse_id', warehouseId)
    .maybeSingle()

  const onHand = Number(stock?.quantity_on_hand ?? 0)
  const reserved = Number(stock?.quantity_reserved ?? 0)
  const available = calculateAvailableQuantity(onHand, reserved)

  const { data: item } = await client
    .from('inventory_items')
    .select('allow_negative_stock')
    .eq('id', input.inventoryItemId)
    .single()

  assertNonNegativeStock(available, qty, Boolean(item?.allow_negative_stock))

  const reservationNo = await getNextSequence('RESERVATION', 'RES-')
  const { data: reservation, error } = await client
    .from('inventory_reservations')
    .insert({
      company_id: companyId,
      reservation_no: reservationNo,
      inventory_item_id: input.inventoryItemId,
      warehouse_id: warehouseId,
      quantity: qty,
      source_type: input.sourceType,
      source_id: input.sourceId,
      status: 'ACTIVE',
      expires_at: input.expiresAt?.toISOString() ?? null,
      notes: input.notes ?? null,
    })
    .select('*')
    .single()

  if (error) throw error

  await client
    .from('warehouse_stock')
    .update({ quantity_reserved: reserved + qty, updated_at: new Date().toISOString() })
    .eq('company_id', companyId)
    .eq('inventory_item_id', input.inventoryItemId)
    .eq('warehouse_id', warehouseId)

  await logInventoryAudit({
    companyId,
    action: 'RESERVATION_CREATED',
    entityType: 'inventory_reservation',
    entityId: String(reservation.id),
    inventoryItemId: input.inventoryItemId,
    warehouseId,
    userId: input.userId,
    beforeState: { available, reserved },
    afterState: { reserved: reserved + qty, available: available - qty },
  })

  return reservation
}

export async function releaseInventoryReservation(reservationId: string, companyId?: string, userId?: string | null) {
  const cid = companyId ?? await resolveCompanyId()
  const client = createAdminClient()

  const { data: reservation, error } = await client
    .from('inventory_reservations')
    .select('*')
    .eq('id', reservationId)
    .eq('company_id', cid)
    .single()

  if (error || !reservation) throw new InventoryError('Reservation not found', 'NOT_FOUND')
  if (reservation.status !== 'ACTIVE') return reservation

  const qty = Number(reservation.quantity)
  const { data: stock } = await client
    .from('warehouse_stock')
    .select('quantity_reserved')
    .eq('company_id', cid)
    .eq('inventory_item_id', reservation.inventory_item_id)
    .eq('warehouse_id', reservation.warehouse_id)
    .maybeSingle()

  const reserved = Number(stock?.quantity_reserved ?? 0)

  await client
    .from('inventory_reservations')
    .update({ status: 'RELEASED' })
    .eq('id', reservationId)

  await client
    .from('warehouse_stock')
    .update({ quantity_reserved: Math.max(0, reserved - qty) })
    .eq('company_id', cid)
    .eq('inventory_item_id', reservation.inventory_item_id)
    .eq('warehouse_id', reservation.warehouse_id)

  await logInventoryAudit({
    companyId: cid,
    action: 'RESERVATION_RELEASED',
    entityType: 'inventory_reservation',
    entityId: reservationId,
    inventoryItemId: String(reservation.inventory_item_id),
    warehouseId: String(reservation.warehouse_id),
    userId,
  })

  return reservation
}

export async function fulfillInventoryReservation(reservationId: string, companyId?: string, userId?: string | null) {
  const cid = companyId ?? await resolveCompanyId()
  const client = createAdminClient()

  const { data: reservation } = await client
    .from('inventory_reservations')
    .select('*')
    .eq('id', reservationId)
    .eq('company_id', cid)
    .single()

  if (!reservation || reservation.status !== 'ACTIVE') return

  await releaseInventoryReservation(reservationId, cid, userId)
  await client.from('inventory_reservations').update({ status: 'FULFILLED' }).eq('id', reservationId)
}
