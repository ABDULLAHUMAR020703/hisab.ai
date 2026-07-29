'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, Download, Filter, Plus, RefreshCw } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { ActionDropdown } from '@/components/ui/action-dropdown'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { PageHeader, SearchBar } from '@/components/ui/page-header'
import { useCompanyCurrency } from '@/hooks/use-company-currency'
import { formatCurrency } from '@/lib/utils'
import { readApiError } from '@/lib/api-client'

type Transaction = { id: string; type: string; date: string; reference: string; payee: string; category: string; subtotal: number; taxAmount: number; total: number; currency: string; status: string; canMarkPaid: boolean; sourceHref: string }
type SortKey = 'date' | 'type' | 'reference' | 'payee' | 'category' | 'subtotal' | 'taxAmount' | 'total'
const TYPES = ['ALL', 'TIME_ACTIVITY', 'BILL', 'EXPENSE', 'CHEQUE', 'PURCHASE_ORDER', 'SUPPLIER_CREDIT', 'CREDIT_CARD_DEBIT', 'PAY_DOWN_CREDIT_CARD', 'IMPORT_BILLS']
const CREATE_LINKS: Record<string, string | undefined> = { BILL: '/bills', EXPENSE: '/expenses', CHEQUE: '/banking?tab=cheques', PURCHASE_ORDER: '/purchase-orders', SUPPLIER_CREDIT: '/vendor-credits' }
function title(value: string) { return value === 'ALL' ? 'All Transactions' : value.toLowerCase().replaceAll('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase()) }
function dateValue(value: string) { return new Intl.DateTimeFormat('en-GB').format(new Date(value)) }

export default function ExpenseTransactionsPage() {
  const router = useRouter(); const { currency: companyCurrency } = useCompanyCurrency()
  const [items, setItems] = useState<Transaction[]>([]); const [total, setTotal] = useState(0); const [page, setPage] = useState(1); const limit = 25
  const [loading, setLoading] = useState(true); const [search, setSearch] = useState(''); const [type, setType] = useState('ALL'); const [showFilters, setShowFilters] = useState(false)
  const [sortBy, setSortBy] = useState<SortKey>('date'); const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [filters, setFilters] = useState({ dateFrom: (() => { const date = new Date(); date.setFullYear(date.getFullYear() - 1); return date.toISOString().slice(0, 10) })(), dateTo: new Date().toISOString().slice(0, 10), payee: '', category: '', tax: '', minTotal: '', maxTotal: '' })

  const load = useCallback(async () => {
    setLoading(true); const params = new URLSearchParams({ page: String(page), limit: String(limit), type, sortBy, sortDir, ...filters }); if (search.trim()) params.set('search', search.trim())
    const response = await fetch(`/api/expense-transactions?${params}`)
    if (response.ok) { const data = await response.json(); setItems(data.items ?? []); setTotal(data.total ?? 0) } else alert(await readApiError(response))
    setLoading(false)
  }, [filters, page, search, sortBy, sortDir, type])
  useEffect(() => { const timer = setTimeout(load, 200); return () => clearTimeout(timer) }, [load])
  const pageCount = Math.max(1, Math.ceil(total / limit))
  const pageAmount = useMemo(() => items.reduce((sum, item) => sum + item.total, 0), [items])
  function sort(key: SortKey) { if (key === sortBy) setSortDir((dir) => dir === 'asc' ? 'desc' : 'asc'); else { setSortBy(key); setSortDir('asc') }; setPage(1) }
  async function action(item: Transaction, action: 'copy' | 'task' | 'delete') {
    if (action === 'delete' && !confirm(`Delete “${item.reference || title(item.type)}”?`)) return
    const response = await fetch(`/api/expense-transactions/${item.type}/${item.id}${action === 'copy' ? '/copy' : action === 'task' ? '/task' : ''}`, { method: action === 'delete' ? 'DELETE' : 'POST' })
    if (!response.ok) alert(await readApiError(response)); else if (action === 'task') alert('Task hook recorded. A task workspace can consume this integration when it is enabled.'); else await load()
  }
  function exportRows() { const params = new URLSearchParams({ type, sortBy, sortDir, ...filters }); if (search.trim()) params.set('search', search.trim()); window.location.assign(`/api/expense-transactions/export?${params}`) }
  return <div className="mx-auto max-w-[1700px] space-y-4 p-4 md:p-6">
    <PageHeader title="Expense Transactions" subtitle={`${total} transactions · ${formatCurrency(pageAmount, companyCurrency)} on this page`} breadcrumb={[{ label: 'Expenses' }, { label: 'Expense Transactions' }]} />
    <div className="flex flex-wrap items-center gap-2">
      <Select aria-label="Transaction type" className="w-auto min-w-48" value={type} onChange={(event) => { setType(event.target.value); setPage(1) }}>{TYPES.map((value) => <option key={value} value={value}>{title(value)}</option>)}</Select>
      <Button variant={showFilters ? 'secondary' : 'outline'} onClick={() => setShowFilters((value) => !value)}><Filter size={14} /> Filter</Button>
      <Button variant="outline" onClick={() => router.push('/bills')}><span className="font-semibold">Pay Bills</span></Button>
      <div className="relative group"><Button><Plus size={15} /> New Transaction <ChevronDown size={14} /></Button><div className="invisible absolute right-0 z-30 mt-1 w-56 rounded-xl border border-slate-200 bg-white p-1 shadow-lg group-hover:visible group-focus-within:visible">{TYPES.slice(1).map((value) => CREATE_LINKS[value] ? <button key={value} onClick={() => router.push(CREATE_LINKS[value]!)} className="block w-full rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50">{title(value)}</button> : <span key={value} className="block px-3 py-2 text-sm text-slate-400">{title(value)} <small>(unavailable)</small></span>)}</div></div>
      <Button variant="ghost" size="icon" onClick={load} aria-label="Refresh"><RefreshCw size={15} className={loading ? 'animate-spin' : ''} /></Button><Button variant="outline" onClick={exportRows}><Download size={14} /> Export</Button>
    </div>
    <div className="flex flex-wrap items-center gap-2"><SearchBar value={search} onChange={(value) => { setSearch(value); setPage(1) }} placeholder="Search transactions" className="w-full sm:w-80" /><span className="text-xs text-slate-500">Last 12 months</span></div>
    {showFilters && <div className="grid grid-cols-2 gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-4 xl:grid-cols-7"><Input aria-label="Start date" type="date" value={filters.dateFrom} onChange={(event) => setFilters({ ...filters, dateFrom: event.target.value })} /><Input aria-label="End date" type="date" value={filters.dateTo} onChange={(event) => setFilters({ ...filters, dateTo: event.target.value })} /><Input placeholder="Payee" value={filters.payee} onChange={(event) => setFilters({ ...filters, payee: event.target.value })} /><Input placeholder="Category" value={filters.category} onChange={(event) => setFilters({ ...filters, category: event.target.value })} /><Select value={filters.tax} onChange={(event) => setFilters({ ...filters, tax: event.target.value })}><option value="">All sales tax</option><option value="WITH_TAX">With tax</option><option value="NO_TAX">No tax</option></Select><Input placeholder="Min total" type="number" value={filters.minTotal} onChange={(event) => setFilters({ ...filters, minTotal: event.target.value })} /><Input placeholder="Max total" type="number" value={filters.maxTotal} onChange={(event) => setFilters({ ...filters, maxTotal: event.target.value })} /></div>}
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"><div className="max-h-[calc(100vh-300px)] overflow-auto"><table className="data-table min-w-[1250px] w-full"><thead className="sticky top-0 z-20 bg-slate-50"><tr><th className="w-10 px-3 py-2.5"><input aria-label="Select all transactions" type="checkbox" /></th>{([['Date','date'],['Type','type'],['No.','reference'],['Payee','payee'],['Category','category'],['Total Before Sales Tax','subtotal'],['Sales Tax','taxAmount'],['Total','total']] as [string, SortKey][]).map(([label, key]) => <th key={key} className={`px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500 ${key.includes('total') || key === 'taxAmount' || key === 'subtotal' ? 'text-right' : ''}`}><button className="w-full hover:text-slate-700" onClick={() => sort(key)}>{label}{sortBy === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}</button></th>)}<th className="sticky right-0 bg-slate-50 px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wide text-slate-500">Action</th></tr></thead><tbody className="divide-y divide-slate-100">{loading ? Array.from({ length: 7 }, (_, row) => <tr key={row}>{Array.from({ length: 10 }, (_, col) => <td key={col} className="px-3 py-2.5"><div className="skeleton h-4" /></td>)}</tr>) : items.length === 0 ? <tr><td colSpan={10} className="px-6 py-20 text-center text-sm text-slate-400">No expense transactions found.</td></tr> : items.map((item) => <tr key={`${item.type}:${item.id}`} className="cursor-pointer text-xs text-slate-600 hover:bg-slate-50" onClick={() => router.push(item.sourceHref)}><td className="px-3 py-2.5" onClick={(event) => event.stopPropagation()}><input aria-label={`Select ${item.reference}`} type="checkbox" /></td><td className="px-3 py-2.5 whitespace-nowrap">{dateValue(item.date)}</td><td className="px-3 py-2.5"><Badge status={item.type} label={title(item.type)} /></td><td className="max-w-52 truncate px-3 py-2.5 font-medium text-slate-800">{item.reference || '—'}</td><td className="max-w-44 truncate px-3 py-2.5">{item.payee}</td><td className="max-w-44 truncate px-3 py-2.5">{item.category}</td><td className="px-3 py-2.5 text-right tabular">{formatCurrency(item.subtotal, item.currency)}</td><td className="px-3 py-2.5 text-right tabular">{formatCurrency(item.taxAmount, item.currency)}</td><td className="px-3 py-2.5 text-right font-semibold tabular text-slate-900">{formatCurrency(item.total, item.currency)}</td><td className="sticky right-0 bg-white px-3 py-2 text-right" onClick={(event) => event.stopPropagation()}><ActionDropdown label="⋮" items={[...(item.canMarkPaid ? [{ label: 'Mark as Paid', onSelect: () => router.push(`/bills?payBill=${item.id}`) }] : []), { label: 'View / Edit', onSelect: () => router.push(item.sourceHref) }, { label: 'Copy', onSelect: () => action(item, 'copy') }, { label: 'Create Task', onSelect: () => action(item, 'task') }, { label: 'Delete', onSelect: () => action(item, 'delete'), danger: true }]} /></td></tr>)}</tbody></table></div><div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-xs text-slate-500"><span>{total ? (page - 1) * limit + 1 : 0}–{Math.min(page * limit, total)} of {total}</span><div className="flex gap-2"><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</Button><Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => setPage((value) => value + 1)}>Next</Button></div></div></div>
  </div>
}
