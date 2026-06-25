'use client'

import { Filter, RotateCcw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SearchBar } from '@/components/ui/page-header'
import {
  countActiveCustomerFilters,
  customerFilterChipLabel,
  type CustomerFilterValues,
} from '@/lib/ui/customer-filters'
import { cn } from '@/lib/utils'

export interface CustomerFilterFacets {
  countries: string[]
  citiesByCountry: Record<string, string[]>
}

interface CustomerFilterCardProps {
  filters: CustomerFilterValues
  facets: CustomerFilterFacets
  onChange: (patch: Partial<CustomerFilterValues>) => void
  onReset: () => void
  onRemoveChip: (key: keyof CustomerFilterValues) => void
}

function FilterSelect({
  label,
  value,
  onChange,
  children,
  disabled,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  children: React.ReactNode
  disabled?: boolean
}) {
  const id = `customer-filter-${label.toLowerCase().replace(/\s+/g, '-')}`
  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      <label htmlFor={id} className="text-xs font-medium text-slate-600">
        {label}
      </label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'input-base w-full bg-white text-sm',
          disabled && 'cursor-not-allowed opacity-60',
        )}
      >
        {children}
      </select>
    </div>
  )
}

function ActiveChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button
      type="button"
      onClick={onRemove}
      className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-800 transition-colors hover:bg-indigo-100"
      aria-label={`Remove filter: ${label}`}
    >
      {label}
      <X size={12} />
    </button>
  )
}

export function CustomerFilterCard({
  filters,
  facets,
  onChange,
  onReset,
  onRemoveChip,
}: CustomerFilterCardProps) {
  const activeCount = countActiveCustomerFilters(filters)
  const cityOptions = filters.country
    ? facets.citiesByCountry[filters.country] ?? []
    : []

  const chips: { key: keyof CustomerFilterValues; label: string }[] = []
  if (filters.search.trim()) {
    const label = customerFilterChipLabel('search', filters.search, filters)
    if (label) chips.push({ key: 'search', label })
  }
  if (filters.country) {
    const label = customerFilterChipLabel('country', filters.country, filters)
    if (label) chips.push({ key: 'country', label })
  }
  if (filters.city) {
    const label = customerFilterChipLabel('city', filters.city, filters)
    if (label) chips.push({ key: 'city', label })
  }
  if (filters.vatFilter) {
    const label = customerFilterChipLabel('vatFilter', filters.vatFilter, filters)
    if (label) chips.push({ key: 'vatFilter', label })
  }
  if (filters.balanceFilter) {
    const label = customerFilterChipLabel('balanceFilter', filters.balanceFilter, filters)
    if (label) chips.push({ key: 'balanceFilter', label })
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm" aria-label="Customer filters">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
            <Filter size={15} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-900 leading-tight">
              Filters
              {activeCount > 0 && (
                <span className="ml-2 inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">
                  {activeCount} active
                </span>
              )}
            </h2>
            <p className="text-xs text-slate-400 hidden sm:block">Search and refine your customer list</p>
          </div>
        </div>
        {activeCount > 0 && (
          <button
            type="button"
            onClick={onReset}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700"
          >
            <X size={13} />
            Clear all
          </button>
        )}
      </div>

      <div className="p-4 space-y-4">
        <SearchBar
          value={filters.search}
          onChange={(v) => onChange({ search: v })}
          placeholder="Search by name, company, VAT, email, or phone…"
          className="w-full max-w-none"
          aria-label="Search customers by name, company, VAT, email, or phone"
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <FilterSelect
            label="Country"
            value={filters.country}
            onChange={(v) => onChange({ country: v, city: '' })}
          >
            <option value="">All countries</option>
            {facets.countries.map((country) => (
              <option key={country} value={country}>{country}</option>
            ))}
          </FilterSelect>

          <FilterSelect
            label="City"
            value={filters.city}
            disabled={!filters.country}
            onChange={(v) => onChange({ city: v })}
          >
            <option value="">{filters.country ? 'All cities' : 'Select country first'}</option>
            {cityOptions.map((city) => (
              <option key={city} value={city}>{city}</option>
            ))}
          </FilterSelect>

          <FilterSelect
            label="VAT"
            value={filters.vatFilter}
            onChange={(v) => onChange({ vatFilter: v as CustomerFilterValues['vatFilter'] })}
          >
            <option value="">All</option>
            <option value="has_vat">Has VAT TRN</option>
            <option value="no_vat">No VAT TRN</option>
            <option value="valid_trn">Valid Saudi TRN</option>
            <option value="invalid_trn">Invalid TRN</option>
          </FilterSelect>

          <FilterSelect
            label="Balance"
            value={filters.balanceFilter}
            onChange={(v) => onChange({ balanceFilter: v as CustomerFilterValues['balanceFilter'] })}
          >
            <option value="">All</option>
            <option value="outstanding">Outstanding balance</option>
            <option value="zero">Zero balance</option>
            <option value="credit">Credit balance</option>
            <option value="over_limit">Over credit limit</option>
          </FilterSelect>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <FilterSelect
            label="Sort by"
            value={filters.sortBy}
            onChange={(v) => onChange({ sortBy: v as CustomerFilterValues['sortBy'] })}
          >
            <option value="name">Customer name</option>
            <option value="createdAt">Created date</option>
            <option value="updatedAt">Updated date</option>
            <option value="outstanding">Balance</option>
            <option value="creditLimit">Credit limit</option>
            <option value="city">City</option>
            <option value="country">Country</option>
          </FilterSelect>

          <FilterSelect
            label="Order"
            value={filters.sortDir}
            onChange={(v) => onChange({ sortDir: v as 'asc' | 'desc' })}
          >
            <option value="asc">Ascending</option>
            <option value="desc">Descending</option>
          </FilterSelect>

          <div className="flex items-end sm:col-span-2 lg:col-span-2 lg:justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onReset}
              className="w-full sm:w-auto"
            >
              <RotateCcw size={14} aria-hidden="true" />
              Reset filters
            </Button>
          </div>
        </div>

        {chips.length > 0 && (
          <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3" role="list" aria-label="Active filters">
            {chips.map((chip) => (
              <span key={chip.key} role="listitem">
                <ActiveChip
                  label={chip.label}
                  onRemove={() => onRemoveChip(chip.key)}
                />
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
