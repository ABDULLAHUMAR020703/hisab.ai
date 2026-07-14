import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCompanyId } from '@/lib/tenant'
import { getNextSequence } from '@/lib/sequences'
import { processInventoryMovement, InventoryError } from './movements'
import { postInventoryAdjustmentJournal } from './journal-posting'
import { logInventoryAudit } from './audit'

export async function createStockCountSession(input: {
  warehouseId: string
  isCycleCount?: boolean
  notes?: string | null
  companyId?: string
  userId?: string | null
}) {
  const companyId = input.companyId ?? await resolveCompanyId()
  const client = createAdminClient()
  const countNo = await getNextSequence('STOCK_COUNT', 'SC-')

  const { data: session, error } = await client
    .from('stock_count_sessions')
    .insert({
      company_id: companyId,
      count_no: countNo,
      warehouse_id: input.warehouseId,
      status: 'DRAFT',
      is_cycle_count: input.isCycleCount ?? false,
      notes: input.notes ?? null,
      created_by_id: input.userId ?? null,
    })
    .select('*')
    .single()

  if (error) throw error

  const { data: stockRows } = await client
    .from('warehouse_stock')
    .select('inventory_item_id, quantity_on_hand, average_cost')
    .eq('company_id', companyId)
    .eq('warehouse_id', input.warehouseId)

  const lines = (stockRows ?? []).map((row) => ({
    company_id: companyId,
    session_id: session.id,
    inventory_item_id: row.inventory_item_id,
    system_quantity: Number(row.quantity_on_hand ?? 0),
    counted_quantity: Number(row.quantity_on_hand ?? 0),
    variance_quantity: 0,
    unit_cost: Number(row.average_cost ?? 0),
    variance_value: 0,
  }))

  if (lines.length > 0) {
    await client.from('stock_count_lines').insert(lines)
  }

  await logInventoryAudit({
    companyId,
    action: 'STOCK_COUNT_CREATED',
    entityType: 'stock_count_session',
    entityId: String(session.id),
    warehouseId: input.warehouseId,
    userId: input.userId,
  })

  return session
}

export async function updateStockCountLine(input: {
  lineId: string
  countedQuantity: number
  companyId?: string
}) {
  const companyId = input.companyId ?? await resolveCompanyId()
  const client = createAdminClient()

  const { data: line, error } = await client
    .from('stock_count_lines')
    .select('*')
    .eq('id', input.lineId)
    .eq('company_id', companyId)
    .single()

  if (error || !line) throw new InventoryError('Count line not found', 'NOT_FOUND')

  const { data: session } = await client
    .from('stock_count_sessions')
    .select('status')
    .eq('id', line.session_id)
    .single()

  if (session?.status === 'POSTED') throw new InventoryError('Count already posted', 'COUNT_POSTED')

  const systemQty = Number(line.system_quantity)
  const countedQty = Number(input.countedQuantity)
  const variance = countedQty - systemQty
  const unitCost = Number(line.unit_cost ?? 0)

  const { data: updated, error: updateError } = await client
    .from('stock_count_lines')
    .update({
      counted_quantity: countedQty,
      variance_quantity: variance,
      variance_value: variance * unitCost,
    })
    .eq('id', input.lineId)
    .select('*')
    .single()

  if (updateError) throw updateError
  return updated
}

export async function postStockCountSession(sessionId: string, companyId?: string, userId?: string | null) {
  const cid = companyId ?? await resolveCompanyId()
  const client = createAdminClient()

  const { data: session, error } = await client
    .from('stock_count_sessions')
    .select('*')
    .eq('id', sessionId)
    .eq('company_id', cid)
    .single()

  if (error || !session) throw new InventoryError('Stock count not found', 'NOT_FOUND')
  if (session.status === 'POSTED') return session

  const { data: lines } = await client
    .from('stock_count_lines')
    .select('*')
    .eq('session_id', sessionId)
    .eq('company_id', cid)

  let totalVarianceValue = 0

  for (const line of lines ?? []) {
    const variance = Number(line.variance_quantity ?? 0)
    if (Math.abs(variance) < 0.0001) continue

    await processInventoryMovement({
      companyId: cid,
      inventoryItemId: String(line.inventory_item_id),
      warehouseId: String(session.warehouse_id),
      quantity: variance,
      unitCost: Number(line.unit_cost ?? 0),
      movementType: 'COUNT_ADJUSTMENT',
      sourceType: 'STOCK_COUNT',
      sourceId: sessionId,
      reference: `Stock count ${session.count_no}`,
      userId,
      postCogsJournal: false,
    })

    totalVarianceValue += Number(line.variance_value ?? 0)
  }

  if (Math.abs(totalVarianceValue) > 0.01) {
    await postInventoryAdjustmentJournal({
      companyId: cid,
      sourceId: sessionId,
      varianceValue: totalVarianceValue,
      description: `Stock count adjustment ${session.count_no}`,
      entryDate: new Date(String(session.count_date)),
      userId,
    })
  }

  await client
    .from('stock_count_sessions')
    .update({ status: 'POSTED', posted_at: new Date().toISOString() })
    .eq('id', sessionId)

  await logInventoryAudit({
    companyId: cid,
    action: 'STOCK_COUNT_POSTED',
    entityType: 'stock_count_session',
    entityId: sessionId,
    warehouseId: String(session.warehouse_id),
    userId,
    afterState: { totalVarianceValue },
  })

  return session
}
