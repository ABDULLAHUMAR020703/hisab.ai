import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCompanyId } from '@/lib/tenant'
import { processInventoryMovement } from './movements'
import { postInventoryCostingJournal } from './journal-posting'

async function canonicalStockItemId(client:ReturnType<typeof createAdminClient>,companyId:string,itemId:string){
  let canonicalId=itemId
  let item=await client.from('inventory_items').select('category').eq('company_id',companyId).eq('id',canonicalId).is('deleted_at',null).maybeSingle()
  if(item.error)throw item.error
  if(!item.data){
    const link=await client.from('quickbooks_migration_local_links').select('realm_id,source_id').eq('company_id',companyId).eq('entity_type','Item').eq('local_id',itemId).order('updated_at',{ascending:false}).limit(1).maybeSingle()
    if(link.error)throw link.error
    if(link.data){const record=await client.from('quickbooks_migration_records').select('local_id').eq('company_id',companyId).eq('realm_id',link.data.realm_id).eq('entity_type','Item').eq('source_id',link.data.source_id).maybeSingle();if(record.error)throw record.error;if(record.data?.local_id)canonicalId=String(record.data.local_id)}
    item=await client.from('inventory_items').select('category').eq('company_id',companyId).eq('id',canonicalId).is('deleted_at',null).maybeSingle()
    if(item.error)throw item.error
  }
  return item.data&&String(item.data.category??'').toLowerCase()!=='services'?canonicalId:null
}

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

  for (const line of bill.lines ?? []) {
    if (!line.inventory_item_id) continue
    const inventoryItemId=await canonicalStockItemId(client,cid,String(line.inventory_item_id));if(!inventoryItemId)continue
    const qty = Number(line.quantity ?? 1)
    if (qty <= 0) continue

    const unitCost = Number(line.unit_price ?? 0)
    const reference = `GRN from bill ${bill.bill_no} line ${line.id}`
    const existing = await client.from('stock_movements').select('id').eq('company_id',cid).eq('source_type','BILL').eq('source_id',billId).eq('inventory_item_id',inventoryItemId).eq('reference',reference).maybeSingle()
    if(existing.error)throw existing.error
    if(existing.data)continue
    const result = await processInventoryMovement({
      companyId: cid,
      inventoryItemId,
      quantity: qty,
      unitCost,
      movementType: 'GOODS_RECEIPT',
      sourceType: 'BILL',
      sourceId: billId,
      reference,
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

  for (const line of invoice.lines ?? []) {
    if (!line.inventory_item_id) continue
    const inventoryItemId=await canonicalStockItemId(client,cid,String(line.inventory_item_id));if(!inventoryItemId)continue
    const qty = Number(line.quantity ?? 1)
    if (qty <= 0) continue
    const reference = `GIN from invoice ${invoice.invoice_no} line ${line.id}`
    const existing = await client.from('stock_movements').select('id').eq('company_id',cid).eq('source_type','INVOICE').eq('source_id',invoiceId).eq('inventory_item_id',inventoryItemId).eq('reference',reference).maybeSingle()
    if(existing.error)throw existing.error
    if(existing.data)continue

    await processInventoryMovement({
      companyId: cid,
      inventoryItemId,
      quantity: qty,
      movementType: 'GOODS_ISSUE',
      sourceType: 'INVOICE',
      sourceId: invoiceId,
      reference,
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
    const inventoryItemId=await canonicalStockItemId(client,cid,String(line.inventory_item_id));if(!inventoryItemId)continue
    const reference=`Sales receipt ${receipt.data.receipt_no} line ${line.id}`
    const existing=await client.from('stock_movements').select('id').eq('company_id',cid).eq('source_type','SALES_RECEIPT').eq('source_id',receiptId).eq('inventory_item_id',line.inventory_item_id).eq('reference',reference).maybeSingle()
    if(existing.error)throw existing.error
    if(existing.data)continue
    await processInventoryMovement({companyId:cid,inventoryItemId,quantity:Number(line.quantity),movementType:'GOODS_ISSUE',sourceType:'SALES_RECEIPT',sourceId:receiptId,reference,userId,postCogsJournal:true,movementDate:new Date(String(receipt.data.date)),reason:'Sales Receipt inventory sale'})
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
    const inventoryItemId=await canonicalStockItemId(client,cid,String(line.inventory_item_id));if(!inventoryItemId)continue
    const movement=await processInventoryMovement({companyId:cid,inventoryItemId,quantity:Number(line.quantity),unitCost:Number(line.unit_price??0),movementType:'GOODS_RECEIPT',sourceType:'CREDIT_NOTE',sourceId:invoiceId,reference:`Return from credit note ${invoice.data.invoice_no}`,userId,postCogsJournal:false,movementDate:new Date(String(invoice.data.date))})
    await postInventoryCostingJournal({companyId:cid,inventoryItemId,sourceId:movement.movementId,cogsAmount:movement.totalCost,description:`Credit note return ${invoice.data.invoice_no}`,entryDate:new Date(String(invoice.data.date)),userId,isReceipt:true})
  }
}

/** A supplier return decreases stock; its Vendor Credit ledger already credits inventory/expense. */
export async function postGoodsReturnToVendorFromCredit(vendorCreditId:string,companyId?:string,userId?:string|null) {
  const cid=companyId??await resolveCompanyId();const client=createAdminClient(),credit=await client.from('vendor_credits').select('credit_no,date,lines:vendor_credit_lines(id,inventory_item_id,quantity,unit_price)').eq('company_id',cid).eq('id',vendorCreditId).single()
  if(credit.error||!credit.data)return
  for(const line of credit.data.lines??[]){if(!line.inventory_item_id||Number(line.quantity??0)<=0)continue;const inventoryItemId=await canonicalStockItemId(client,cid,String(line.inventory_item_id));if(!inventoryItemId)continue;const reference=`Vendor credit ${credit.data.credit_no} line ${line.id}`,existing=await client.from('stock_movements').select('id').eq('company_id',cid).eq('source_type','SUPPLIER_CREDIT').eq('source_id',vendorCreditId).eq('inventory_item_id',inventoryItemId).eq('reference',reference).maybeSingle();if(existing.error)throw existing.error;if(existing.data)continue
    await processInventoryMovement({companyId:cid,inventoryItemId,quantity:Number(line.quantity),unitCost:Number(line.unit_price??0),movementType:'GOODS_ISSUE',sourceType:'SUPPLIER_CREDIT',sourceId:vendorCreditId,reference,userId,postCogsJournal:false,movementDate:new Date(String(credit.data.date)),reason:'QuickBooks Vendor Credit inventory return'})
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
