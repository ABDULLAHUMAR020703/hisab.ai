import 'server-only'
import { mapInventoryItemRow } from '../entity-mappers'
import type { InventoryItemRecord } from '../entities'
import { queryByIdOrLegacy, resolveCompanyId, supabaseDb } from '../repository-utils'
import { resolveSequenceRepository } from '../sequence-resolver'
import type {
  InventoryBatchDuplicateInput,
  InventoryBatchDuplicateMatch,
  InventoryCreateInput,
  InventoryDuplicateCriteria,
  InventoryListOptions,
  InventoryRepository,
  InventoryUpdateInput,
} from './inventory.repository.interface'

async function resolveInventoryUuid(id: string, companyId: string): Promise<string | null> {
  const row = await queryByIdOrLegacy(supabaseDb(), 'inventory_items', id, companyId)
  return row ? String(row.id) : null
}

export const supabaseInventoryRepository: InventoryRepository = {
  async findMany(options: InventoryListOptions = {}) {
    const db = supabaseDb()
    const companyId = await resolveCompanyId()
    const search = options.search?.trim()

    let query = db
      .from('inventory_items')
      .select('*')
      .eq('company_id', companyId)
      .is('deleted_at', null)
      .order('name', { ascending: true })

    if (search) {
      query = query.or(
        `name.ilike.%${search}%,item_code.ilike.%${search}%,category.ilike.%${search}%`,
      )
    }

    const { data, error } = await query
    if (error) throw error
    return (data ?? []).map(mapInventoryItemRow)
  },

  async findById(id: string) {
    const db = supabaseDb()
    const companyId = await resolveCompanyId()
    const row = await queryByIdOrLegacy(db, 'inventory_items', id, companyId)
    return row ? mapInventoryItemRow(row) : null
  },

  async findDuplicate(criteria: InventoryDuplicateCriteria) {
    const db = supabaseDb()
    const companyId = await resolveCompanyId()

    const itemCode = criteria.itemCode?.trim()
    if (itemCode) {
      const { data, error } = await db
        .from('inventory_items')
        .select('*')
        .eq('company_id', companyId)
        .eq('item_code', itemCode)
        .is('deleted_at', null)
        .limit(1)
        .maybeSingle()
      if (error) throw error
      if (data) return mapInventoryItemRow(data)
    }

    const name = criteria.name?.trim()
    if (name) {
      const { data, error } = await db
        .from('inventory_items')
        .select('*')
        .eq('company_id', companyId)
        .ilike('name', name)
        .is('deleted_at', null)
        .limit(1)
        .maybeSingle()
      if (error) throw error
      if (data) return mapInventoryItemRow(data)
    }

    return null
  },

  async findDuplicatesBatch(inputs: InventoryBatchDuplicateInput[]) {
    if (inputs.length === 0) return []

    const db = supabaseDb()
    const companyId = await resolveCompanyId()

    const itemCodes = [...new Set(inputs.map((item) => item.itemCode?.trim()).filter(Boolean) as string[])]
    const names = [...new Set(inputs.map((item) => item.name?.trim().toLowerCase()).filter(Boolean) as string[])]

    const byItemCode = new Map<string, InventoryItemRecord>()
    const byName = new Map<string, InventoryItemRecord>()

    if (itemCodes.length > 0) {
      const { data, error } = await db
        .from('inventory_items')
        .select('*')
        .eq('company_id', companyId)
        .in('item_code', itemCodes)
        .is('deleted_at', null)
      if (error) throw error
      for (const row of data ?? []) {
        const item = mapInventoryItemRow(row)
        byItemCode.set(item.itemCode, item)
      }
    }

    if (names.length > 0) {
      const { data, error } = await db
        .from('inventory_items')
        .select('id, item_code, name')
        .eq('company_id', companyId)
        .is('deleted_at', null)
      if (error) throw error

      const nameSet = new Set(names)
      for (const row of data ?? []) {
        const item = mapInventoryItemRow(row)
        if (nameSet.has(item.name.toLowerCase())) {
          byName.set(item.name.toLowerCase(), item)
        }
      }
    }

    const matches: InventoryBatchDuplicateMatch[] = []
    for (const input of inputs) {
      const itemCode = input.itemCode?.trim()
      const name = input.name?.trim().toLowerCase()

      let existing: InventoryItemRecord | undefined
      const matchedOn: string[] = []

      if (itemCode && byItemCode.has(itemCode)) {
        existing = byItemCode.get(itemCode)
        matchedOn.push('itemCode')
      } else if (name && byName.has(name)) {
        existing = byName.get(name)
        matchedOn.push('name')
      }

      if (existing) {
        matches.push({
          rowNumber: input.rowNumber,
          existingId: existing.id,
          matchedOn: matchedOn.length ? matchedOn : ['name'],
        })
      }
    }

    return matches
  },

  async create(input: InventoryCreateInput) {
    const db = supabaseDb()
    const companyId = await resolveCompanyId()
    const itemCode = input.itemCode?.trim()
      || await resolveSequenceRepository().next('ITEM', 'ITEM-')

    const { data, error } = await db
      .from('inventory_items')
      .insert({
        company_id: companyId,
        item_code: itemCode,
        name: input.name,
        description: input.description ?? null,
        category: input.category ?? null,
        unit: input.unit ?? 'PCS',
        cost_price: input.costPrice ?? 0,
        sale_price: input.salePrice ?? 0,
        quantity: input.quantity ?? 0,
        min_quantity: input.minQuantity ?? 0,
        is_active: input.isActive ?? true,
      })
      .select('*')
      .single()

    if (error) throw error
    return mapInventoryItemRow(data)
  },

  async update(id: string, input: InventoryUpdateInput) {
    const db = supabaseDb()
    const companyId = await resolveCompanyId()
    const itemId = await resolveInventoryUuid(id, companyId)
    if (!itemId) throw new Error('Inventory item not found')

    const patch: Record<string, unknown> = {}
    if (input.name !== undefined) patch.name = input.name
    if (input.itemCode !== undefined) patch.item_code = input.itemCode
    if (input.description !== undefined) patch.description = input.description
    if (input.category !== undefined) patch.category = input.category
    if (input.unit !== undefined) patch.unit = input.unit
    if (input.costPrice !== undefined) patch.cost_price = input.costPrice
    if (input.salePrice !== undefined) patch.sale_price = input.salePrice
    if (input.quantity !== undefined) patch.quantity = input.quantity
    if (input.minQuantity !== undefined) patch.min_quantity = input.minQuantity
    if (input.isActive !== undefined) patch.is_active = input.isActive

    const { data, error } = await db
      .from('inventory_items')
      .update(patch)
      .eq('id', itemId)
      .eq('company_id', companyId)
      .is('deleted_at', null)
      .select('*')
      .single()

    if (error) throw error
    return mapInventoryItemRow(data)
  },

  async delete(id: string) {
    const db = supabaseDb()
    const companyId = await resolveCompanyId()
    const itemId = await resolveInventoryUuid(id, companyId)
    if (!itemId) throw new Error('Inventory item not found')

    const { error } = await db
      .from('inventory_items')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', itemId)
      .eq('company_id', companyId)

    if (error) throw error
  },
}
