import type { CostCenterRecord } from '../entities'

export interface CostCenterListOptions {
  search?: string
  type?: string
  activeOnly?: boolean
}

export interface CostCenterBatchDuplicateInput {
  rowNumber: number
  code?: string | null
  name?: string | null
}

export interface CostCenterBatchDuplicateMatch {
  rowNumber: number
  existingId: string
  matchedOn: string[]
}

export interface CostCenterDuplicateCriteria {
  code?: string | null
  name?: string | null
  type?: string | null
}

export interface CostCenterCreateInput {
  code?: string
  name: string
  type?: string
  description?: string | null
  isActive?: boolean
  metadata?: Record<string, unknown> | null
}

export interface CostCenterUpdateInput {
  name?: string
  type?: string
  description?: string | null
  isActive?: boolean
  metadata?: Record<string, unknown> | null
}

export interface CostCenterRepository {
  findMany(options?: CostCenterListOptions): Promise<CostCenterRecord[]>
  findById(id: string): Promise<CostCenterRecord | null>
  findDuplicate(criteria: CostCenterDuplicateCriteria): Promise<CostCenterRecord | null>
  findDuplicatesBatch(inputs: CostCenterBatchDuplicateInput[]): Promise<CostCenterBatchDuplicateMatch[]>
  create(input: CostCenterCreateInput): Promise<CostCenterRecord>
  update(id: string, input: CostCenterUpdateInput): Promise<CostCenterRecord>
  delete(id: string): Promise<void>
}
