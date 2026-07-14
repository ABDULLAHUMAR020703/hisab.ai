import type { VendorRecord } from '../entities'

export interface VendorListOptions {
  search?: string
  includeOutstanding?: boolean
}

export interface VendorBatchDuplicateInput {
  rowNumber: number
  email?: string | null
  taxId?: string | null
  name?: string | null
}

export interface VendorBatchDuplicateMatch {
  rowNumber: number
  existingId: string
  matchedOn: string[]
}

export interface VendorDuplicateCriteria {
  email?: string | null
  taxId?: string | null
  name?: string | null
}

export interface VendorCreateInput {
  name: string
  email?: string | null
  phone?: string | null
  address?: string | null
  city?: string | null
  country?: string | null
  taxId?: string | null
  paymentTerms?: number
  isActive?: boolean
}

export interface VendorUpdateInput {
  name?: string
  email?: string | null
  phone?: string | null
  address?: string | null
  city?: string | null
  country?: string | null
  taxId?: string | null
  paymentTerms?: number
  isActive?: boolean
}

export interface VendorRepository {
  findMany(options?: VendorListOptions): Promise<VendorRecord[]>
  findById(id: string): Promise<VendorRecord | null>
  findDuplicate(criteria: VendorDuplicateCriteria): Promise<VendorRecord | null>
  findDuplicatesBatch(inputs: VendorBatchDuplicateInput[]): Promise<VendorBatchDuplicateMatch[]>
  create(input: VendorCreateInput): Promise<VendorRecord>
  update(id: string, input: VendorUpdateInput): Promise<VendorRecord>
  delete(id: string): Promise<void>
}
