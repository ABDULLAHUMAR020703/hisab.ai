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

/** A paid sale reduces stock on its historical transaction date and posts COGS once per source line. */
export async function postGoodsIssueFromSalesReceipt(receiptId:string,companyId?:string,userId?:string|null) {
  const cid=companyId??await resolveCompanyId(),client=createAdminClient()
  const receipt=await client.from('sales_receipts').select('receipt_no,date,lines:sales_receipt_lines(id,inventory_item_id,quantity)').eq('company_id',cid).eq('id',receiptId).is('deleted_at',null).single()
  if(receipt.error||!receipt.data)throw new Error('Sales Receipt not found')
  for(const line of receipt.data.lines??[]){
    if(!line.inventory_item_id||Number(line.quantity??0)<=0)continue
    const reference=`Sales receipt ${receipt.data.receipt_no} line ${line.id}`
    const existing=await client.from('stock_movements').select('id').eq('company_id',cid).eq('source_type','SALES_RECEIPT').eq('source_id',receiptId).eq('inventory_item_id',line.inventory_item_id).eq('reference',reference).maybeSingle()
    if(existing.error)throw existing.error
    if(existing.data)continue
    await processInventoryMovement({companyId:cid,inventoryItemId:String(line.inventory_item_id),quantity:Number(line.quantity),movementType:'GOODS_ISSUE',sourceType:'SALES_RECEIPT',sourceId:receiptId,reference,userId,postCogsJournal:true,movementDate:new Date(String(receipt.data.date)),reason:'Sales Receipt inventory sale'})
  }
}

/** Customer credit note return â€” restores inventory through the same costing engine. */
export async function postGoodsReturnFromCreditNote(invoiceId:string,companyId?:string,userId?:string|null) {
  const cid=companyId??await resolveCompanyId(); const client=createAdminClient()
  const invoice=await client.from('invoices').select('*, lines:invoice_lines(*)').eq('id',invoiceId).eq('company_id',cid).single()
  if(invoice.error||!invoice.data) return
  const existing=await client.from('stock_movements').select('id').eq('company_id',cid).eq('source_type','CREDIT_NOTE').eq('source_id',invoiceId).limit(1)
  if(existing.data?.length) return
  for(const line of invoice.data.lines??[]) {
    if(!line.inventory_item_id||Number(line.quantity??0)<=0) continue
    const movement=await processInventoryMovement({companyId:cid,inventoryItemId:String(line.inventory_item_id),quantity:Number(line.quantity),unitCost:Number(line.unit_price??0),movementType:'GOODS_RECEIPT',sourceType:'CREDIT_NOTE',sourceId:invoiceId,reference:`Return from credit note ${invoice.data.invoice_no}`,userId,postCogsJournal:false,movementDate:new Date(String(invoice.data.date))})
    await postInventoryCostingJournal({companyId:cid,inventoryItemId:String(line.inventory_item_id),sourceId:movement.movementId,cogsAmount:movement.totalCost,description:`Credit note return ${invoice.data.invoice_no}`,entryDate:new Date(String(invoice.data.date)),userId,isReceipt:true})
  }
}

/** A supplier return decreases stock; its Vendor Credit ledger already credits inventory/expense. */
export async function postGoodsReturnToVendorFromCredit(vendorCreditId:string,companyId?:string,userId?:string|null) {
  const cid=companyId??await resolveCompanyId();const client=createAdminClient(),credit=await client.from('vendor_credits').select('credit_no,date,lines:vendor_credit_lines(id,inventory_item_id,quantity,unit_price)').eq('company_id',cid).eq('id',vendorCreditId).single()
  if(credit.error||!credit.data)return
  for(const line of credit.data.lines??[]){if(!line.inventory_item_id||Number(line.quantity??0)<=0)continue;const reference=`Vendor credit ${credit.data.credit_no} line ${line.id}`,existing=await client.from('stock_movements').select('id').eq('company_id',cid).eq('source_type','SUPPLIER_CREDIT').eq('source_id',vendorCreditId).eq('inventory_item_id',line.inventory_item_id).eq('reference',reference).maybeSingle();if(existing.error)throw existing.error;if(existing.data)continue
    await processInventoryMovement({companyId:cid,inventoryItemId:String(line.inventory_item_id),quantity:Number(line.quantity),unitCost:Number(line.unit_price??0),movementType:'GOODS_ISSUE',sourceType:'SUPPLIER_CREDIT',sourceId:vendorCreditId,reference,userId,postCogsJournal:false,movementDate:new Date(String(credit.data.date)),reason:'QuickBooks Vendor Credit inventory return'})
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
