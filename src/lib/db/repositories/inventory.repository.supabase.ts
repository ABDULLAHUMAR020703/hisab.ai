import 'server-only'
import { mapInventoryItemRow } from '../entity-mappers'
import type { InventoryItemRecord } from '../entities'
import { queryByIdOrLegacy, resolveCompanyId, supabaseDb } from '../repository-utils'
import type { InventoryListOptions, InventoryRepository } from './inventory.repository.interface'

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
}
