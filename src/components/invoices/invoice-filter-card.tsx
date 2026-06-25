'use client'

import { Filter, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SearchBar } from '@/components/ui/page-header'
import { formatInvoiceTypeLabel } from '@/lib/ui/invoice-status'
import { cn } from '@/lib/utils'

export interface InvoiceFilterValues {
  search: string
  statusFilter: string
  zatcaFilter: string
  typeFilter: string
  customerFilter: string
  datePreset: string
  dateFrom: string
  dateTo: string
  sortBy: string
  sortDir: 'asc' | 'desc'
}

export const DEFAULT_INVOICE_FILTERS: InvoiceFilterValues = {
  search: '',
  statusFilter: '',
  zatcaFilter: '',
  typeFilter: '',
  customerFilter: '',
  datePreset: '',
  dateFrom: '',
  dateTo: '',
  sortBy: 'createdAt',
  sortDir: 'desc',
}

export const INVOICE_FILTERS_STORAGE_KEY = 'hisab-invoice-filters'

export function loadStoredInvoiceFilters(): InvoiceFilterValues {
  if (typeof window === 'undefined') return DEFAULT_INVOICE_FILTERS
  try {
    const raw = localStorage.getItem(INVOICE_FILTERS_STORAGE_KEY)
    if (!raw) return DEFAULT_INVOICE_FILTERS
    return { ...DEFAULT_INVOICE_FILTERS, ...JSON.parse(raw) }
  } catch {
    return DEFAULT_INVOICE_FILTERS
  }
}

export function countActiveInvoiceFilters(filters: InvoiceFilterValues): number {
  let count = 0
  if (filters.search.trim()) count++
  if (filters.statusFilter) count++
  if (filters.zatcaFilter) count++
  if (filters.typeFilter) count++
  if (filters.customerFilter) count++
  if (filters.datePreset) count++
  return count
}

interface CustomerOption {
  id: string
  name: string
}

interface InvoiceFilterCardProps {
  draft: InvoiceFilterValues
  applied: InvoiceFilterValues
  customers: CustomerOption[]
  onChange: (patch: Partial<InvoiceFilterValues>) => void
  onApply: () => void
  onResetDraft: () => void
  onClearAll: () => void
}

function FilterSelect({
  label,
  value,
  onChange,
  children,
  className,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  children: React.ReactNode
  className?: string
}) {
  const id = `invoice-filter-${label.toLowerCase().replace(/\s+/g, '-')}`
  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      <label htmlFor={id} className="text-xs font-medium text-slate-600">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn('input-base w-full bg-white text-sm', className)}
      >
        {children}
      </select>
    </div>
  )
}

function FilterDateInput({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  const id = `invoice-filter-${label.toLowerCase().replace(/\s+/g, '-')}`
  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      <label htmlFor={id} className="text-xs font-medium text-slate-600">
        {label}
      </label>
      <input
        id={id}
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input-base w-full bg-white text-sm"
      />
    </div>
  )
}

export function InvoiceFilterCard({
  draft,
  applied,
  customers,
  onChange,
  onApply,
  onResetDraft,
  onClearAll,
}: InvoiceFilterCardProps) {
  const activeCount = countActiveInvoiceFilters(applied)
  const draftDirty = JSON.stringify(draft) !== JSON.stringify(applied)

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
            <Filter size={15} />
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
            <p className="text-xs text-slate-400 hidden sm:block">Refine the invoice list, then apply</p>
          </div>
        </div>
        {activeCount > 0 && (
          <button
            type="button"
            onClick={onClearAll}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700"
          >
            <X size={13} />
            Clear all
          </button>
        )}
      </div>

      <div className="p-4 space-y-4">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (draftDirty) onApply()
          }}
        >
        <SearchBar
          value={draft.search}
          onChange={(v) => onChange({ search: v })}
          placeholder="Search invoice # or customer..."
          className="w-full max-w-none"
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <FilterSelect
            label="Business"
            value={draft.statusFilter}
            onChange={(v) => onChange({ statusFilter: v })}
          >
            <option value="">All businesses</option>
            {['DRAFT', 'SENT', 'PAID', 'PARTIAL', 'OVERDUE', 'VOID'].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </FilterSelect>

          <FilterSelect
            label="ZATCA"
            value={draft.zatcaFilter}
            onChange={(v) => onChange({ zatcaFilter: v })}
          >
            <option value="">All statuses</option>
            <option value="DRAFT">Not submitted</option>
            {['PENDING', 'SUBMITTED', 'CLEARED', 'REPORTED', 'FAILED', 'REJECTED'].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </FilterSelect>

          <FilterSelect
            label="Type"
            value={draft.typeFilter}
            onChange={(v) => onChange({ typeFilter: v })}
          >
            <option value="">All types</option>
            {['STANDARD', 'SIMPLIFIED', 'CREDIT_NOTE', 'DEBIT_NOTE'].map((t) => (
              <option key={t} value={t}>{formatInvoiceTypeLabel(t)}</option>
            ))}
          </FilterSelect>

          <FilterSelect
            label="Customer"
            value={draft.customerFilter}
            onChange={(v) => onChange({ customerFilter: v })}
          >
            <option value="">All customers</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </FilterSelect>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <FilterSelect
            label="Date"
            value={draft.datePreset}
            onChange={(v) => onChange({ datePreset: v, ...(v !== 'custom' ? { dateFrom: '', dateTo: '' } : {}) })}
          >
            <option value="">All dates</option>
            <option value="today">Today</option>
            <option value="week">This week</option>
            <option value="month">This month</option>
            <option value="custom">Custom range</option>
          </FilterSelect>

          <FilterSelect
            label="Sort by"
            value={draft.sortBy}
            onChange={(v) => onChange({ sortBy: v })}
          >
            <option value="createdAt">Newest</option>
            <option value="date">Invoice date</option>
            <option value="dueDate">Due date</option>
            <option value="invoiceNo">Invoice #</option>
            <option value="total">Amount</option>
            <option value="customerName">Customer</option>
          </FilterSelect>

          <FilterSelect
            label="Order"
            value={draft.sortDir}
            onChange={(v) => onChange({ sortDir: v as 'asc' | 'desc' })}
          >
            <option value="desc">Descending</option>
            <option value="asc">Ascending</option>
          </FilterSelect>
        </div>

        {draft.datePreset === 'custom' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <FilterDateInput
              label="From"
              value={draft.dateFrom}
              onChange={(v) => onChange({ dateFrom: v })}
            />
            <FilterDateInput
              label="To"
              value={draft.dateTo}
              onChange={(v) => onChange({ dateTo: v })}
            />
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-4">
          <Button type="button" variant="outline" size="sm" onClick={onResetDraft}>
            Reset
          </Button>
          <Button type="submit" size="sm" disabled={!draftDirty}>
            Apply filters
          </Button>
        </div>
        </form>
      </div>
    </section>
  )
}
