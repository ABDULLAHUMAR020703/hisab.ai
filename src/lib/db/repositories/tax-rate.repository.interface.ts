import type { TaxRateRecord } from '../entities'

export interface TaxRateListOptions {
  search?: string
}

export interface TaxRateBatchDuplicateInput {
  rowNumber: number
  name?: string | null
}

export interface TaxRateBatchDuplicateMatch {
  rowNumber: number
  existingId: string
  matchedOn: string[]
}

export interface TaxRateDuplicateCriteria {
  name?: string | null
}

export interface TaxRateCreateInput {
  name: string
  rate: number
  type?: string
  isDefault?: boolean
  isReverseCharge?: boolean
  isActive?: boolean
}

export interface TaxRateUpdateInput {
  name?: string
  rate?: number
  type?: string
  isDefault?: boolean
  isReverseCharge?: boolean
  isActive?: boolean
}

export interface TaxRateRepository {
  findMany(options?: TaxRateListOptions): Promise<TaxRateRecord[]>
  findById(id: string): Promise<TaxRateRecord | null>
  findDuplicate(criteria: TaxRateDuplicateCriteria): Promise<TaxRateRecord | null>
  findDuplicatesBatch(inputs: TaxRateBatchDuplicateInput[]): Promise<TaxRateBatchDuplicateMatch[]>
  create(input: TaxRateCreateInput): Promise<TaxRateRecord>
  update(id: string, input: TaxRateUpdateInput): Promise<TaxRateRecord>
  delete(id: string): Promise<void>
}
