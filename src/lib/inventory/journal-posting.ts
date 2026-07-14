import 'server-only'
import { findSystemAccount, postSourceDocumentToLedger } from '@/lib/accounting/posting-service'
import { createAdminClient } from '@/lib/supabase/admin'

export async function postInventoryCostingJournal(input: {
  companyId: string
  inventoryItemId: string
  sourceId: string
  cogsAmount: number
  description: string
  entryDate: Date
  userId?: string | null
  isReceipt?: boolean
}): Promise<void> {
  if (input.cogsAmount <= 0) return

  const client = createAdminClient()
  const { data: item } = await client
    .from('inventory_items')
    .select('cogs_account_id, inventory_asset_account_id, name')
    .eq('id', input.inventoryItemId)
    .eq('company_id', input.companyId)
    .maybeSingle()

  const inventoryAsset = item?.inventory_asset_account_id
    ? String(item.inventory_asset_account_id)
    : await findSystemAccount(input.companyId, { accountNoPrefix: '11-1103' })
  const cogsAccount = item?.cogs_account_id
    ? String(item.cogs_account_id)
    : await findSystemAccount(input.companyId, { accountNoPrefix: '51' })

  if (!inventoryAsset || !cogsAccount) return

  const amount = input.cogsAmount
  const lines = input.isReceipt
    ? [
        { accountId: inventoryAsset, debit: amount, description: input.description },
        { accountId: cogsAccount, credit: amount, description: input.description },
      ]
    : [
        { accountId: cogsAccount, debit: amount, description: input.description },
        { accountId: inventoryAsset, credit: amount, description: input.description },
      ]

  await postSourceDocumentToLedger({
    companyId: input.companyId,
    sourceType: 'INVENTORY',
    sourceId: input.sourceId,
    entryDate: input.entryDate,
    description: input.description,
    lines,
    userId: input.userId,
    reason: 'Inventory costing',
  })
}

export async function postInventoryAdjustmentJournal(input: {
  companyId: string
  sourceId: string
  varianceValue: number
  description: string
  entryDate: Date
  userId?: string | null
}): Promise<void> {
  if (Math.abs(input.varianceValue) < 0.01) return

  const inventoryAsset = await findSystemAccount(input.companyId, { accountNoPrefix: '11-1103' })
  const expenseAccount = await findSystemAccount(input.companyId, { accountNoPrefix: '61' })
  if (!inventoryAsset || !expenseAccount) return

  const amount = Math.abs(input.varianceValue)
  const isGain = input.varianceValue > 0
  const lines = isGain
    ? [
        { accountId: inventoryAsset, debit: amount, description: input.description },
        { accountId: expenseAccount, credit: amount, description: input.description },
      ]
    : [
        { accountId: expenseAccount, debit: amount, description: input.description },
        { accountId: inventoryAsset, credit: amount, description: input.description },
      ]

  await postSourceDocumentToLedger({
    companyId: input.companyId,
    sourceType: 'INVENTORY',
    sourceId: input.sourceId,
    entryDate: input.entryDate,
    description: input.description,
    lines,
    userId: input.userId,
    reason: 'Stock count adjustment',
  })
}
