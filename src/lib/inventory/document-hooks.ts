import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCompanyId } from '@/lib/tenant'
import { processInventoryMovement } from './movements'
import { postInventoryCostingJournal } from './journal-posting'

/** Goods receipt from bill — increments stock for lines with inventory_item_id. */
export async function postGoodsReceiptFromBill(billId: string, companyId?: string, userId?: string | null) {
  const cid = companyId ?? await resolveCompanyId()
  const client = createAdminClient()

  const { data: bill, error } = await client
    .from('bills')
    .select('*, lines:bill_lines(*)')
    .eq('id', billId)
    .eq('company_id', cid)
    .single()

  if (error || !bill) return

  const { data: existing } = await client
    .from('stock_movements')
    .select('id')
    .eq('company_id', cid)
    .eq('source_type', 'BILL')
    .eq('source_id', billId)
    .limit(1)

  if (existing && existing.length > 0) return

  for (const line of bill.lines ?? []) {
    if (!line.inventory_item_id) continue
    const qty = Number(line.quantity ?? 1)
    if (qty <= 0) continue

    const unitCost = Number(line.unit_price ?? 0)
    const result = await processInventoryMovement({
      companyId: cid,
      inventoryItemId: String(line.inventory_item_id),
      quantity: qty,
      unitCost,
      movementType: 'GOODS_RECEIPT',
      sourceType: 'BILL',
      sourceId: billId,
      reference: `GRN from bill ${bill.bill_no}`,
      userId,
      postCogsJournal: false,
    })

    await postInventoryCostingJournal({
      companyId: cid,
      inventoryItemId: String(line.inventory_item_id),
      sourceId: result.movementId,
      cogsAmount: result.totalCost,
      description: `Goods receipt ${bill.bill_no}`,
      entryDate: new Date(String(bill.date)),
      userId,
      isReceipt: true,
    })
  }
}

/** Goods issue from invoice — decrements stock for lines with inventory_item_id. */
export async function postGoodsIssueFromInvoice(invoiceId: string, companyId?: string, userId?: string | null) {
  const cid = companyId ?? await resolveCompanyId()
  const client = createAdminClient()

  const { data: invoice, error } = await client
    .from('invoices')
    .select('*, lines:invoice_lines(*)')
    .eq('id', invoiceId)
    .eq('company_id', cid)
    .single()

  if (error || !invoice) return

  const { data: existing } = await client
    .from('stock_movements')
    .select('id')
    .eq('company_id', cid)
    .eq('source_type', 'INVOICE')
    .eq('source_id', invoiceId)
    .limit(1)

  if (existing && existing.length > 0) return

  for (const line of invoice.lines ?? []) {
    if (!line.inventory_item_id) continue
    const qty = Number(line.quantity ?? 1)
    if (qty <= 0) continue

    await processInventoryMovement({
      companyId: cid,
      inventoryItemId: String(line.inventory_item_id),
      quantity: qty,
      movementType: 'GOODS_ISSUE',
      sourceType: 'INVOICE',
      sourceId: invoiceId,
      reference: `GIN from invoice ${invoice.invoice_no}`,
      userId,
      postCogsJournal: true,
    })
  }
}

/** Reserve stock when invoice is created/sent (optional). */
export async function reserveStockForInvoice(invoiceId: string, companyId?: string) {
  const cid = companyId ?? await resolveCompanyId()
  const client = createAdminClient()

  const { data: invoice } = await client
    .from('invoices')
    .select('*, lines:invoice_lines(*)')
    .eq('id', invoiceId)
    .eq('company_id', cid)
    .single()

  if (!invoice) return

  const { createInventoryReservation } = await import('./reservations')

  for (const line of invoice.lines ?? []) {
    if (!line.inventory_item_id) continue
    const qty = Number(line.quantity ?? 1)
    if (qty <= 0) continue

    try {
      await createInventoryReservation({
        companyId: cid,
        inventoryItemId: String(line.inventory_item_id),
        quantity: qty,
        sourceType: 'INVOICE',
        sourceId: invoiceId,
        notes: `Reserved for invoice ${invoice.invoice_no}`,
      })
    } catch {
      // Reservation optional — skip if insufficient stock
    }
  }
}
