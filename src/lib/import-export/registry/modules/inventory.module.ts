import 'server-only'
import type { InventoryItemRecord } from '@/lib/db/entities'
import { getInventoryRepository } from '@/lib/db/provider'
import {
  parseBooleanField,
  parseNumberField,
  parseOptionalString,
} from '../../parse-helpers'
import type { DuplicateMatch, MappedRow, ModuleDefinition } from '../../types'
import { INVENTORY_FIELDS } from './inventory.fields'
import { INVENTORY_OFFICIAL_TEMPLATES } from './inventory.official-templates'
import { createAdminClient } from '@/lib/supabase/admin'

export { INVENTORY_FIELDS } from './inventory.fields'

function parseInventoryImportRow(mapped: Record<string, unknown>) {
  return {
    name: String(mapped.name ?? '').trim(),
    itemCode: parseOptionalString(mapped.itemCode) ?? undefined,
    description: parseOptionalString(mapped.description),
    category: parseOptionalString(mapped.category),
    unit: parseOptionalString(mapped.unit) ?? 'PCS',
    costPrice: parseNumberField(mapped.costPrice, 0),
    salePrice: parseNumberField(mapped.salePrice, 0),
    quantity: parseNumberField(mapped.quantity, 0),
    minQuantity: parseNumberField(mapped.minQuantity, 0),
    isActive: parseBooleanField(mapped.isActive, true),
  }
}

async function applyQuickBooksInventoryPolicy(id:string,record:Record<string,unknown>){
  if(typeof record._quickbooksRaw!=='string')return
  let raw:Record<string,unknown>
  try{raw=JSON.parse(record._quickbooksRaw) as Record<string,unknown>}catch{return}
  if(String(raw.Type??'').toLowerCase()!=='inventory')return
  // QuickBooks permits dated sales that temporarily drive stock negative.
  // Preserve that source behaviour during historical replay.
  const updated=await createAdminClient().from('inventory_items').update({allow_negative_stock:true}).eq('id',id)
  if(updated.error)throw updated.error
}

export const inventoryModule: ModuleDefinition = {
  key: 'inventory',
  displayName: 'Inventory',
  fields: INVENTORY_FIELDS,
  officialTemplates: INVENTORY_OFFICIAL_TEMPLATES,
  duplicateKeys: ['itemCode', 'name'],

  transformOfficialRow(mapped, templateId) {
    if (templateId !== 'standard') return mapped
    const itemType = String(mapped.itemType ?? '').trim().toLowerCase()
    const category = mapped.category
      ? String(mapped.category)
      : itemType === 'service' ? 'Services' : 'Products'
    const {
      itemType: _itemType,
      purchaseCostIncludesTax: _a,
      salesPriceIncludesTax: _b,
      incomeAccount: _c,
      expenseAccount: _d,
      inventoryAssetAccount: _e,
      purchaseDescription: _f,
      preferredSupplier: _g,
      ...rest
    } = mapped
    return {
      ...rest,
      category,
      unit: itemType === 'service' ? 'SVC' : 'PCS',
      isActive: true,
    }
  },

  parseImportRow: (mapped) => parseInventoryImportRow(mapped) as unknown as Record<string, unknown>,

  async findDuplicate(record) {
    const parsed = parseInventoryImportRow(record)
    const existing = await getInventoryRepository().findDuplicate({
      itemCode: parsed.itemCode,
      name: parsed.name,
    })
    if (!existing) return null
    const matchedOn: string[] = []
    if (parsed.itemCode && existing.itemCode === parsed.itemCode) matchedOn.push('itemCode')
    else if (parsed.name && existing.name.toLowerCase() === parsed.name.toLowerCase()) matchedOn.push('name')
    return { id: existing.id, matchedOn: matchedOn.length ? matchedOn : ['name'] }
  },

  async findDuplicatesBatch(rows: MappedRow[]) {
    const repo = getInventoryRepository()
    const inputs = rows.map((row) => {
      const parsed = parseInventoryImportRow(row.mapped)
      return {
        rowNumber: row.rowNumber,
        itemCode: parsed.itemCode,
        name: parsed.name,
      }
    })
    const matches = await repo.findDuplicatesBatch(inputs)
    return matches.map((match): DuplicateMatch => ({
      rowNumber: match.rowNumber,
      existingId: match.existingId,
      matchedOn: match.matchedOn,
    }))
  },

  async createRecord(record) {
    const parsed = parseInventoryImportRow(record)
    const created = await getInventoryRepository().create(parsed)
    await applyQuickBooksInventoryPolicy(created.id,record)
    return { id: created.id }
  },

  async updateRecord(id, record) {
    const parsed = parseInventoryImportRow(record)
    await getInventoryRepository().update(id, parsed)
    await applyQuickBooksInventoryPolicy(id,record)
  },

  async exportRecords(filters) {
    return getInventoryRepository().findMany({ search: filters.search || undefined })
  },

  mapExportRow(record) {
    const item = record as InventoryItemRecord
    return {
      name: item.name,
      itemCode: item.itemCode,
      description: item.description,
      category: item.category,
      unit: item.unit,
      costPrice: item.costPrice,
      salePrice: item.salePrice,
      quantity: item.quantity,
      minQuantity: item.minQuantity,
      isActive: item.isActive,
    }
  },
}
