'use client'

import { useEffect, useState } from 'react'
import { Plus, RefreshCw, DollarSign, Upload, FileUp } from 'lucide-react'
import { formatDate, formatCurrency as formatAmount, cn } from '@/lib/utils'
import { useCompanyCurrency, useFormatCurrency } from '@/hooks/use-company-currency'
import { ALLOWED_CURRENCIES } from '@/lib/currency/constants'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { Input, Select, Textarea } from '@/components/ui/input'
import { PageHeader, SearchBar, FilterBar } from '@/components/ui/page-header'
import { CsvImportModal } from '@/components/ui/csv-import-modal'
import { UploadDocumentModal } from '@/components/ui/upload-document-modal'
import { readApiError } from '@/lib/api-client'

interface Vendor { id: string; name: string }
interface Account { id: string; accountNo: string; name: string }
interface BillLine { description: string; quantity: number; unitPrice: number; taxRate: number; accountId?: string }
interface Bill {
  id: string; billNo: string; vendor: { name: string }; date: string; dueDate: string
  total: number; balance: number; amountPaid: number; status: string; currency?: string
}

const EMPTY_LINE: BillLine = { description: '', quantity: 1, unitPrice: 0, taxRate: 15, accountId: '' }
const STATUSES = ['DRAFT', 'APPROVED', 'PAID', 'PARTIAL', 'OVERDUE']

export default function BillsPage() {
  const formatPrimary = useFormatCurrency()
  const { currency: primaryCurrency } = useCompanyCurrency()
  const [bills, setBills] = useState<Bill[]>([])
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [showUpload, setShowUpload] = useState(false)
  const [showPayModal, setShowPayModal] = useState(false)
  const [selectedBill, setSelectedBill] = useState<Bill | null>(null)
  const [saving, setSaving] = useState(false)

  const [form, setForm] = useState({
    vendorId: '', date: new Date().toISOString().split('T')[0],
    dueDate: '', notes: '', reference: '', currency: 'SAR',
    lines: [{ ...EMPTY_LINE }]
  })
  const [payForm, setPayForm] = useState({ amount: 0, method: 'BANK_TRANSFER', reference: '', date: new Date().toISOString().split('T')[0] })

  async function load() {
    setLoading(true)
    const params = new URLSearchParams()
    if (search) params.set('search', search)
    if (statusFilter) params.set('status', statusFilter)
    const [bRes, vRes, aRes] = await Promise.all([
      fetch(`/api/bills?${params}`), fetch('/api/vendors'), fetch('/api/accounts')
    ])
    if (bRes.ok) setBills(await bRes.json())
    if (vRes.ok) setVendors(await vRes.json())
    if (aRes.ok) setAccounts(await aRes.json())
    setLoading(false)
  }

  useEffect(() => { load() }, [search, statusFilter])

  function updateLine(idx: number, field: string, value: string | number) {
    setForm(f => ({ ...f, lines: f.lines.map((l, i) => i === idx ? { ...l, [field]: value } : l) }))
  }

  const subtotal = form.lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0)
  const taxAmount = form.lines.reduce((s, l) => s + l.quantity * l.unitPrice * (l.taxRate / 100), 0)
  const total = subtotal + taxAmount
  const formatFormAmount = (amount: number) => formatAmount(amount, form.currency)
  const formatBillAmount = (bill: Bill, amount: number) => formatAmount(amount, bill.currency ?? primaryCurrency)

  function openCreateBill() {
    setForm({
      vendorId: '', date: new Date().toISOString().split('T')[0],
      dueDate: '', notes: '', reference: '', currency: primaryCurrency,
      lines: [{ ...EMPTY_LINE }],
    })
    setShowModal(true)
  }

  async function handleSave() {
    setSaving(true)
    const res = await fetch('/api/bills', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
    if (!res.ok) {
      alert(await readApiError(res))
      setSaving(false)
      return
    }
    if (res.ok) { setShowModal(false); load() }
    setSaving(false)
  }

  async function handlePayment() {
    if (!selectedBill) return
    const res = await fetch(`/api/bills/${selectedBill.id}/payment`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payForm) })
    if (!res.ok) {
      alert(await readApiError(res))
      return
    }
    if (res.ok) { setShowPayModal(false); load() }
  }

  return (
    <div className="p-6 max-w-[1600px] mx-auto space-y-5">
      <PageHeader
        title="Bills"
        subtitle={`${bills.length} bills · ${formatPrimary(bills.reduce((s, b) => s + b.total, 0))} total`}
        breadcrumb={[{ label: 'Expenses' }, { label: 'Bills' }]}
        action={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setShowUpload(true)}><FileUp size={14} /> Upload Bill</Button>
            <Button variant="outline" onClick={() => setShowImport(true)}><Upload size={14} /> Import CSV</Button>
            <Button onClick={openCreateBill}><Plus size={15} /> New Bill</Button>
          </div>
        }
      />

      <FilterBar>
        <SearchBar value={search} onChange={setSearch} placeholder="Search bills..." className="flex-1 max-w-sm" />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="input-base w-auto min-w-[140px]">
          <option value="">All Statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <button onClick={load} className="p-2 border border-slate-200 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-50 bg-white transition-colors">
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
        </button>
      </FilterBar>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full data-table">
            <thead>
              <tr className="border-b border-slate-100">
                {['Bill #', 'Vendor', 'Date', 'Due Date', 'Total', 'Paid', 'Balance', 'Status', ''].map((h, i) => (
                  <th key={i} className={cn('px-4 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wider text-left', ['Total', 'Paid', 'Balance'].includes(h) && 'text-right', h === 'Status' && 'text-center', h === '' && 'w-20')}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {loading ? Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>{Array.from({ length: 9 }).map((_, j) => <td key={j} className="px-4 py-3"><div className="skeleton h-4 rounded" /></td>)}</tr>
              )) : bills.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-16 text-center text-slate-400 text-sm">No bills found.</td></tr>
              ) : bills.map(b => (
                <tr key={b.id} className="hover:bg-slate-50/60 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs font-semibold text-indigo-600">{b.billNo}</td>
                  <td className="px-4 py-3 font-semibold text-slate-800 text-sm">{b.vendor.name}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{formatDate(b.date)}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{formatDate(b.dueDate)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-900 tabular text-sm">{formatBillAmount(b, b.total)}</td>
                  <td className="px-4 py-3 text-right text-xs text-emerald-600 font-medium tabular">{formatBillAmount(b, b.amountPaid)}</td>
                  <td className="px-4 py-3 text-right">
                    <span className={cn('text-xs font-semibold tabular', b.balance > 0 ? 'text-rose-600' : 'text-slate-300')}>
                      {b.balance > 0 ? formatBillAmount(b, b.balance) : '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center"><Badge status={b.status} /></td>
                  <td className="px-4 py-3">
                    {b.balance > 0 && b.status !== 'DRAFT' && (
                      <button onClick={() => { setSelectedBill(b); setPayForm(f => ({ ...f, amount: b.balance })); setShowPayModal(true) }}
                        className="flex items-center gap-1 text-xs font-semibold text-emerald-600 hover:bg-emerald-50 px-2 py-1 rounded-lg transition-colors">
                        <DollarSign size={10} /> Pay
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <CsvImportModal type="bills" open={showImport} onClose={() => setShowImport(false)} onSuccess={load} />
      <UploadDocumentModal open={showUpload} onClose={() => setShowUpload(false)} title="Upload Bill Document" />

      <Modal open={showModal} onClose={() => setShowModal(false)} title="New Bill" subtitle="Record a vendor bill" size="xl"
        footer={<><Button variant="outline" onClick={() => setShowModal(false)}>Cancel</Button><Button onClick={handleSave} loading={saving}>Save Bill</Button></>}
      >
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Select label="Vendor" required value={form.vendorId} onChange={e => setForm({ ...form, vendorId: e.target.value })}>
              <option value="">Select vendor...</option>
              {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </Select>
            <Input label="Bill Date" type="date" required value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
            <Input label="Due Date" type="date" required value={form.dueDate} onChange={e => setForm({ ...form, dueDate: e.target.value })} />
            <Select label="Currency" required value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })}>
              {ALLOWED_CURRENCIES.map((entry) => (
                <option key={entry.code} value={entry.code}>{entry.code} — {entry.name}</option>
              ))}
            </Select>
          </div>
          <p className="text-xs text-slate-400 -mt-3">
            Defaults to your company primary currency ({primaryCurrency}). Changing this affects only this bill.
          </p>
          <Input label="Vendor Reference #" value={form.reference} onChange={e => setForm({ ...form, reference: e.target.value })} placeholder="Vendor invoice number" />
          <div>
            <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">Line Items</label>
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    {['Description', 'Account', 'Qty', 'Unit Price', 'Tax %', 'Amount', ''].map((h, i) => (
                      <th key={i} className="px-3 py-2.5 text-[10px] font-semibold text-slate-500 uppercase text-left">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {form.lines.map((line, idx) => (
                    <tr key={idx}>
                      <td className="px-2 py-2"><input value={line.description} onChange={e => updateLine(idx, 'description', e.target.value)} placeholder="Description" className="input-base text-xs py-1.5" /></td>
                      <td className="px-2 py-2 min-w-[120px]">
                        <select value={line.accountId} onChange={e => updateLine(idx, 'accountId', e.target.value)} className="input-base text-xs py-1.5 bg-white">
                          <option value="">—</option>
                          {accounts.filter(a => ['5', '6'].some(p => a.accountNo.startsWith(p))).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                        </select>
                      </td>
                      <td className="px-2 py-2 w-20"><input type="number" min="0" value={line.quantity} onChange={e => updateLine(idx, 'quantity', parseFloat(e.target.value) || 0)} className="input-base text-xs py-1.5 text-right" /></td>
                      <td className="px-2 py-2 w-28"><input type="number" min="0" value={line.unitPrice} onChange={e => updateLine(idx, 'unitPrice', parseFloat(e.target.value) || 0)} className="input-base text-xs py-1.5 text-right" /></td>
                      <td className="px-2 py-2 w-20"><input type="number" min="0" max="100" value={line.taxRate} onChange={e => updateLine(idx, 'taxRate', parseFloat(e.target.value) || 0)} className="input-base text-xs py-1.5 text-right" /></td>
                      <td className="px-3 py-2 text-right text-sm font-semibold text-slate-700 tabular whitespace-nowrap">{formatFormAmount(line.quantity * line.unitPrice * (1 + line.taxRate / 100))}</td>
                      <td className="px-2 py-2 text-center"><button onClick={() => setForm(f => ({ ...f, lines: f.lines.filter((_, i) => i !== idx) }))} className="w-6 h-6 rounded-lg bg-red-50 text-red-400 hover:bg-red-100 hover:text-red-600 flex items-center justify-center text-base">×</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="bg-slate-50 border-t border-slate-200 px-4 py-3 flex flex-col items-end gap-1">
                <div className="flex gap-8 text-sm"><span className="text-slate-500">Subtotal:</span><span className="font-medium tabular w-28 text-right">{formatFormAmount(subtotal)}</span></div>
                <div className="flex gap-8 text-sm"><span className="text-slate-500">VAT:</span><span className="font-medium tabular w-28 text-right">{formatFormAmount(taxAmount)}</span></div>
                <div className="flex gap-8 text-base font-bold border-t border-slate-200 pt-1 mt-1"><span className="text-slate-800">Total:</span><span className="text-rose-600 tabular w-28 text-right">{formatFormAmount(total)}</span></div>
              </div>
            </div>
            <button onClick={() => setForm(f => ({ ...f, lines: [...f.lines, { ...EMPTY_LINE }] }))} className="mt-2 flex items-center gap-1.5 text-sm text-indigo-600 hover:text-indigo-800 font-medium">
              <Plus size={14} /> Add Line
            </button>
          </div>
          <Textarea label="Notes" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} />
        </div>
      </Modal>

      <Modal open={showPayModal} onClose={() => setShowPayModal(false)} title="Record Payment"
        subtitle={selectedBill ? `${selectedBill.billNo} · Balance: ${formatBillAmount(selectedBill, selectedBill.balance)}` : ''} size="sm"
        footer={<><Button variant="outline" onClick={() => setShowPayModal(false)}>Cancel</Button><Button variant="success" onClick={handlePayment}><DollarSign size={14} /> Record</Button></>}
      >
        <div className="space-y-4">
          <Input label="Amount" type="number" required value={payForm.amount} onChange={e => setPayForm({ ...payForm, amount: parseFloat(e.target.value) })} />
          <Input label="Date" type="date" required value={payForm.date} onChange={e => setPayForm({ ...payForm, date: e.target.value })} />
          <Select label="Method" value={payForm.method} onChange={e => setPayForm({ ...payForm, method: e.target.value })}>
            <option value="BANK_TRANSFER">Bank Transfer</option>
            <option value="CASH">Cash</option>
            <option value="CHEQUE">Cheque</option>
            <option value="CARD">Card</option>
          </Select>
          <Input label="Reference" value={payForm.reference} onChange={e => setPayForm({ ...payForm, reference: e.target.value })} />
        </div>
      </Modal>
    </div>
  )
}
