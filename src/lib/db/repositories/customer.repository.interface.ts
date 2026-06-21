import type { CustomerRecord } from '../entities'

export interface CustomerListOptions {
  search?: string
}

export interface CustomerCreateInput {
  name: string
  email?: string | null
  phone?: string | null
  address?: string | null
  city?: string | null
  country?: string | null
  taxId?: string | null
  creditLimit?: number
  paymentTerms?: number
}

export interface CustomerUpdateInput {
  name?: string
  email?: string | null
  phone?: string | null
  address?: string | null
  city?: string | null
  country?: string | null
  taxId?: string | null
  creditLimit?: number
  paymentTerms?: number
  isActive?: boolean
}

export interface CustomerRepository {
  findMany(options?: CustomerListOptions): Promise<CustomerRecord[]>
  findById(id: string): Promise<CustomerRecord | null>
  create(input: CustomerCreateInput): Promise<CustomerRecord>
  update(id: string, input: CustomerUpdateInput): Promise<CustomerRecord>
  delete(id: string): Promise<void>
}
