import type { InventoryItemRecord } from '../entities'

export interface InventoryListOptions {
  search?: string
}

export interface InventoryRepository {
  findMany(options?: InventoryListOptions): Promise<InventoryItemRecord[]>
  findById(id: string): Promise<InventoryItemRecord | null>
}
