export type CustomerVatFilter = '' | 'has_vat' | 'no_vat' | 'valid_trn' | 'invalid_trn'

export type CustomerBalanceFilter = '' | 'outstanding' | 'zero' | 'credit' | 'over_limit'

export type CustomerSortField =
  | 'name'
  | 'createdAt'
  | 'updatedAt'
  | 'outstanding'
  | 'creditLimit'
  | 'city'
  | 'country'

export interface CustomerFilterValues {
  search: string
  country: string
  city: string
  vatFilter: CustomerVatFilter
  balanceFilter: CustomerBalanceFilter
  sortBy: CustomerSortField
  sortDir: 'asc' | 'desc'
}

export const DEFAULT_CUSTOMER_FILTERS: CustomerFilterValues = {
  search: '',
  country: '',
  city: '',
  vatFilter: '',
  balanceFilter: '',
  sortBy: 'name',
  sortDir: 'asc',
}

export const CUSTOMER_FILTERS_STORAGE_KEY = 'hisab-customer-filters'

export function loadStoredCustomerFilters(): CustomerFilterValues {
  if (typeof window === 'undefined') return DEFAULT_CUSTOMER_FILTERS
  try {
    const raw = localStorage.getItem(CUSTOMER_FILTERS_STORAGE_KEY)
    if (!raw) return DEFAULT_CUSTOMER_FILTERS
    return { ...DEFAULT_CUSTOMER_FILTERS, ...JSON.parse(raw) }
  } catch {
    return DEFAULT_CUSTOMER_FILTERS
  }
}

export function countActiveCustomerFilters(filters: CustomerFilterValues): number {
  let count = 0
  if (filters.search.trim()) count++
  if (filters.country) count++
  if (filters.city) count++
  if (filters.vatFilter) count++
  if (filters.balanceFilter) count++
  return count
}

export function customerFilterChipLabel(
  key: keyof CustomerFilterValues,
  value: string,
  filters: CustomerFilterValues,
): string | null {
  if (!value) return null
  switch (key) {
    case 'search':
      return `Search: ${value}`
    case 'country':
      return value
    case 'city':
      return value
    case 'vatFilter': {
      const labels: Record<CustomerVatFilter, string> = {
        '': '',
        has_vat: 'Has VAT TRN',
        no_vat: 'No VAT TRN',
        valid_trn: 'Valid Saudi TRN',
        invalid_trn: 'Invalid TRN',
      }
      return labels[filters.vatFilter] || null
    }
    case 'balanceFilter': {
      const labels: Record<CustomerBalanceFilter, string> = {
        '': '',
        outstanding: 'Outstanding balance',
        zero: 'Zero balance',
        credit: 'Credit balance',
        over_limit: 'Over credit limit',
      }
      return labels[filters.balanceFilter] || null
    }
    default:
      return null
  }
}
