import type { VendorRecord } from '../entities'

export interface VendorListOptions {
  search?: string
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
  create(input: VendorCreateInput): Promise<VendorRecord>
  update(id: string, input: VendorUpdateInput): Promise<VendorRecord>
  delete(id: string): Promise<void>
}
