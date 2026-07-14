import type { CustomerRecord } from '../entities'

export type CustomerSortField =
  | 'name'
  | 'createdAt'
  | 'updatedAt'
  | 'outstanding'
  | 'creditLimit'
  | 'city'
  | 'country'

export type CustomerVatFilter = '' | 'has_vat' | 'no_vat' | 'valid_trn' | 'invalid_trn'

export type CustomerBalanceFilter = '' | 'outstanding' | 'zero' | 'credit' | 'over_limit'

export interface CustomerFilterFacets {
  countries: string[]
  citiesByCountry: Record<string, string[]>
}

export interface CustomerListOptions {
  search?: string
  country?: string
  city?: string
  hasVat?: boolean
  vatFilter?: CustomerVatFilter
  hasOutstanding?: boolean
  creditLimitExceeded?: boolean
  balanceFilter?: CustomerBalanceFilter
  sortBy?: CustomerSortField
  sortDir?: 'asc' | 'desc'
  includeOutstanding?: boolean
}

export interface CustomerBatchDuplicateInput {
  rowNumber: number
  email?: string | null
  taxId?: string | null
  name?: string | null
}

export interface CustomerBatchDuplicateMatch {
  rowNumber: number
  existingId: string
  matchedOn: string[]
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
  isActive?: boolean
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

export interface CustomerDuplicateCriteria {
  email?: string | null
  taxId?: string | null
  name?: string | null
}

export interface CustomerRepository {
  findMany(options?: CustomerListOptions): Promise<CustomerRecord[]>
  getFilterFacets(): Promise<CustomerFilterFacets>
  findById(id: string): Promise<CustomerRecord | null>
  findDuplicate(criteria: CustomerDuplicateCriteria): Promise<CustomerRecord | null>
  findDuplicatesBatch(inputs: CustomerBatchDuplicateInput[]): Promise<CustomerBatchDuplicateMatch[]>
  create(input: CustomerCreateInput): Promise<CustomerRecord>
  update(id: string, input: CustomerUpdateInput): Promise<CustomerRecord>
  delete(id: string): Promise<void>
}
