import type { InventoryItemRecord } from '../entities'

export interface InventoryListOptions {
  search?: string
}

export interface InventoryBatchDuplicateInput {
  rowNumber: number
  itemCode?: string | null
  name?: string | null
}

export interface InventoryBatchDuplicateMatch {
  rowNumber: number
  existingId: string
  matchedOn: string[]
}

export interface InventoryDuplicateCriteria {
  itemCode?: string | null
  name?: string | null
}

export interface InventoryCreateInput {
  name: string
  itemCode?: string
  description?: string | null
  category?: string | null
  unit?: string
  costPrice?: number
  salePrice?: number
  quantity?: number
  minQuantity?: number
  isActive?: boolean
}

export interface InventoryUpdateInput {
  name?: string
  itemCode?: string
  description?: string | null
  category?: string | null
  unit?: string
  costPrice?: number
  salePrice?: number
  quantity?: number
  minQuantity?: number
  isActive?: boolean
}

export interface InventoryRepository {
  findMany(options?: InventoryListOptions): Promise<InventoryItemRecord[]>
  findById(id: string): Promise<InventoryItemRecord | null>
  findDuplicate(criteria: InventoryDuplicateCriteria): Promise<InventoryItemRecord | null>
  findDuplicatesBatch(inputs: InventoryBatchDuplicateInput[]): Promise<InventoryBatchDuplicateMatch[]>
  create(input: InventoryCreateInput): Promise<InventoryItemRecord>
  update(id: string, input: InventoryUpdateInput): Promise<InventoryItemRecord>
  delete(id: string): Promise<void>
}
