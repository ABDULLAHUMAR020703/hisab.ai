'use client'

import { useEffect, useState } from 'react'
import { Plus, RefreshCw, Send, DollarSign, RotateCcw, Eye, Shield } from 'lucide-react'
import { formatDate, formatCurrency, cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { Input, Select, Textarea } from '@/components/ui/input'
import { PageHeader, SearchBar, FilterBar } from '@/components/ui/page-header'

interface Customer { id: string; name: string }
interface Account { id: string; accountNo: string; name: string }
interface InvoiceLine { description: string; quantity: number; unitPrice: number; taxRate: number; accountId?: string }
interface Invoice {
  id: string; invoiceNo: string; customer: { name: string }; date: string; dueDate: string
  total: number; balance: number; amountPaid: number; status: string; isRecurring: boolean
  invoiceType?: string; zatcaStatus?: string
}

interface ZatcaInvoiceStatus {
  invoiceId: string
  invoiceNo: string
  zatcaStatus: string
  requestId: string | null
  responseCode: string | null
  responseMessage: string | null
  clearanceStatus: string | null
  submittedAt: string | null
  canSubmit: boolean
}

const STATUSES = ['DRAFT', 'SENT', 'PAID', 'PARTIAL', 'OVERDUE']
const EMPTY_LINE: InvoiceLine = { description: '', quantity: 1, unitPrice: 0, taxRate: 15, accountId: '' }

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [showPayModal, setShowPayModal] = useState(false)
  const [showViewModal, setShowViewModal] = useState(false)
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null)
  const [zatcaStatus, setZatcaStatus] = useState<ZatcaInvoiceStatus | null>(null)
  const [submittingZatca, setSubmittingZatca] = useState(false)
  const [zatcaMsg, setZatcaMsg] = useState<string | null>(null)
  const [zatcaErr, setZatcaErr] = useState<string | null>(null)
  const [qrPreview, setQrPreview] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [form, setForm] = useState({
    customerId: '', date: new Date().toISOString().split('T')[0],
    dueDate: '', notes: '', terms: 'Net 30', isRecurring: false,
    lines: [{ ...EMPTY_LINE }]
  })
  const [payForm, setPayForm] = useState({
    amount: 0, method: 'BANK_TRANSFER', reference: '',
    date: new Date().toISOString().split('T')[0]
  })

  async function load() {
    setLoading(true)
    const params = new URLSearchParams()
    if (search) params.set('search', search)
    if (statusFilter) params.set('status', statusFilter)
    const [invRes, custRes, accRes] = await Promise.all([
      fetch(`/api/invoices?${params}`),
      fetch('/api/customers'),
      fetch('/api/accounts'),
    ])
    if (invRes.ok) setInvoices(await invRes.json())
    if (custRes.ok) setCustomers(await custRes.json())
    if (accRes.ok) setAccounts(await accRes.json())
    setLoading(false)
  }

  useEffect(() => { load() }, [search, statusFilter])

  function updateLine(idx: number, field: string, value: string | number) {
    setForm(f => ({ ...f, lines: f.lines.map((l, i) => i === idx ? { ...l, [field]: value } : l) }))
  }

  const subtotal = form.lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0)
  const taxAmount = form.lines.reduce((s, l) => s + l.quantity * l.unitPrice * (l.taxRate / 100), 0)
  const total = subtotal + taxAmount

  async function handleSave() {
    setSaving(true)
    const res = await fetch('/api/invoices', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form)
    })
    if (res.ok) { setShowModal(false); load() }
    setSaving(false)
  }

  async function handlePayment() {
    if (!selectedInvoice) return
    const res = await fetch(`/api/invoices/${selectedInvoice.id}/payment`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payForm)
    })
    if (res.ok) { setShowPayModal(false); load() }
  }

  async function handleSend(id: string) {
    await fetch(`/api/invoices/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'SENT' })
    })
    load()
  }

  function openPay(inv: Invoice) {
    setSelectedInvoice(inv)
    setPayForm(f => ({ ...f, amount: inv.balance }))
    setShowPayModal(true)
  }

  async function openView(inv: Invoice) {
    setSelectedInvoice(inv)
    setZatcaMsg(null)
    setZatcaErr(null)
    setQrPreview(null)
    setShowViewModal(true)
    const [statusRes, qrRes] = await Promise.all([
      fetch(`/api/zatca/invoices/${inv.id}/status`),
      fetch(`/api/zatca/invoices/${inv.id}/qr`),
    ])
    if (statusRes.ok) setZatcaStatus(await statusRes.json())
    else setZatcaStatus(null)
    if (qrRes.ok) {
      const qr = await qrRes.json()
      setQrPreview(qr.qrDataUrl ?? null)
    }
  }

  function openArtifact(type: 'xml' | 'signed-xml' | 'qr') {
    if (!selectedInvoice) return
    const base = `/api/zatca/invoices/${selectedInvoice.id}`
    const url = type === 'xml' ? `${base}/xml` : type === 'signed-xml' ? `${base}/signed-xml` : `${base}/qr`
    window.open(url, '_blank')
  }

  async function handleZatcaSubmit() {
    if (!selectedInvoice) return
    setSubmittingZatca(true)
    setZatcaMsg(null)
    setZatcaErr(null)
    const res = await fetch(`/api/zatca/invoices/${selectedInvoice.id}/submit`, { method: 'POST' })
    const data = await res.json()
    if (res.ok) {
      setZatcaMsg(`Submitted via ${data.route} API — status: ${data.zatcaStatus}`)
      const statusRes = await fetch(`/api/zatca/invoices/${selectedInvoice.id}/status`)
      if (statusRes.ok) setZatcaStatus(await statusRes.json())
      load()
    } else {
      setZatcaErr(data.error || 'Submission failed')
    }
    setSubmittingZatca(false)
  }

  const stats = {
    total: invoices.length,
    paid: invoices.filter(i => i.status === 'PAID').length,
    outstanding: invoices.filter(i => ['SENT', 'PARTIAL', 'OVERDUE'].includes(i.status)).length,
    totalValue: invoices.reduce((s, i) => s + i.total, 0),
  }

  return (
    <div className="p-6 max-w-[1600px] mx-auto space-y-5">
      <PageHeader
        title="Invoices"
        subtitle={`${stats.total} invoices · ${formatCurrency(stats.totalValue)} total`}
        breadcrumb={[{ label: 'Income' }, { label: 'Invoices' }]}
        action={
          <Button onClick={() => { setForm({ customerId: '', date: new Date().toISOString().split('T')[0], dueDate: '', notes: '', terms: 'Net 30', isRecurring: false, lines: [{ ...EMPTY_LINE }] }); setShowModal(true) }}>
            <Plus size={15} /> New Invoice
          </Button>
        }
      />

      {/* Stats strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Invoices', value: stats.total, color: 'text-slate-700' },
          { label: 'Paid', value: stats.paid, color: 'text-emerald-600' },
          { label: 'Outstanding', value: stats.outstanding, color: 'text-amber-600' },
          { label: 'Total Value', value: formatCurrency(stats.totalValue), color: 'text-indigo-600' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-slate-200 px-4 py-3">
            <p className="text-xs text-slate-400 font-medium">{s.label}</p>
            <p className={cn('text-lg font-bold mt-0.5', s.color)}>{s.value}</p>
          </div>
        ))}
      </div>

      <FilterBar>
        <SearchBar value={search} onChange={setSearch} placeholder="Search by invoice no or customer..." className="flex-1 max-w-sm" />
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="input-base w-auto min-w-[140px]"
        >
          <option value="">All Statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <button onClick={load} className="p-2 border border-slate-200 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-50 bg-white transition-colors">
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
        </button>
      </FilterBar>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full data-table">
            <thead>
              <tr className="border-b border-slate-100">
                {['Invoice #', 'Customer', 'Date', 'Due Date', 'Total', 'Paid', 'Balance', 'Status', ''].map((h, i) => (
                  <th key={i} className={cn(
                    'px-4 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wider whitespace-nowrap',
                    ['Total', 'Paid', 'Balance'].includes(h) ? 'text-right' : h === 'Status' ? 'text-center' : 'text-left',
                    h === '' && 'w-24'
                  )}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 9 }).map((_, j) => (
                      <td key={j} className="px-4 py-3"><div className="skeleton h-4 rounded" /></td>
                    ))}
                  </tr>
                ))
              ) : invoices.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-16 text-center text-slate-400 text-sm">No invoices found</td></tr>
              ) : invoices.map(inv => (
                <tr key={inv.id} className="hover:bg-slate-50/60 transition-colors">
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs font-semibold text-indigo-600">{inv.invoiceNo}</span>
                    {inv.isRecurring && <RotateCcw size={10} className="inline ml-1.5 text-violet-400" />}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700 font-medium">{inv.customer.name}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{formatDate(inv.date)}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{formatDate(inv.dueDate)}</td>
                  <td className="px-4 py-3 text-right text-sm font-semibold text-slate-900 tabular">{formatCurrency(inv.total)}</td>
                  <td className="px-4 py-3 text-right text-xs text-emerald-600 font-medium tabular">{formatCurrency(inv.amountPaid)}</td>
                  <td className="px-4 py-3 text-right">
                    <span className={cn('text-xs font-semibold tabular', inv.balance > 0 ? 'text-amber-600' : 'text-slate-300')}>
                      {inv.balance > 0 ? formatCurrency(inv.balance) : '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex flex-col items-center gap-1">
                      <Badge status={inv.status} />
                      {inv.zatcaStatus && inv.zatcaStatus !== 'DRAFT' && (
                        <span className="text-[10px] font-medium text-emerald-600">{inv.zatcaStatus}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                      <button onClick={() => openView(inv)}
                        className="flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-slate-700 hover:bg-slate-100 px-2 py-1 rounded-lg transition-colors">
                        <Eye size={10} /> View
                      </button>
                      {inv.status === 'DRAFT' && (
                        <button onClick={() => handleSend(inv.id)}
                          className="flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-800 hover:bg-blue-50 px-2 py-1 rounded-lg transition-colors">
                          <Send size={10} /> Send
                        </button>
                      )}
                      {inv.balance > 0 && inv.status !== 'DRAFT' && (
                        <button onClick={() => openPay(inv)}
                          className="flex items-center gap-1 text-[11px] font-semibold text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50 px-2 py-1 rounded-lg transition-colors">
                          <DollarSign size={10} /> Pay
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* New Invoice Modal */}
      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title="New Invoice"
        subtitle="Create a new customer invoice"
        size="xl"
        footer={
          <>
            <Button variant="outline" onClick={() => setShowModal(false)}>Cancel</Button>
            <Button onClick={handleSave} loading={saving}>Save Invoice</Button>
          </>
        }
      >
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Select label="Customer" required value={form.customerId} onChange={e => setForm({ ...form, customerId: e.target.value })}>
              <option value="">Select customer...</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
            <Input label="Date" type="date" required value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
            <Input label="Due Date" type="date" required value={form.dueDate} onChange={e => setForm({ ...form, dueDate: e.target.value })} />
          </div>

          {/* Lines */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">Line Items</label>
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    {['Description', 'Account', 'Qty', 'Unit Price', 'Tax %', 'Amount', ''].map((h, i) => (
                      <th key={i} className="px-3 py-2.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider text-left">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {form.lines.map((line, idx) => (
                    <tr key={idx}>
                      <td className="px-2 py-2">
                        <input value={line.description} onChange={e => updateLine(idx, 'description', e.target.value)}
                          placeholder="Description" className="input-base text-xs py-1.5" />
                      </td>
                      <td className="px-2 py-2 min-w-[140px]">
                        <select value={line.accountId} onChange={e => updateLine(idx, 'accountId', e.target.value)}
                          className="input-base text-xs py-1.5 bg-white">
                          <option value="">—</option>
                          {accounts.filter(a => ['4', '40', '41'].some(p => a.accountNo.startsWith(p))).map(a => (
                            <option key={a.id} value={a.id}>{a.name}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-2 w-20">
                        <input type="number" min="0" step="0.01" value={line.quantity}
                          onChange={e => updateLine(idx, 'quantity', parseFloat(e.target.value) || 0)}
                          className="input-base text-xs py-1.5 text-right" />
                      </td>
                      <td className="px-2 py-2 w-28">
                        <input type="number" min="0" step="0.01" value={line.unitPrice}
                          onChange={e => updateLine(idx, 'unitPrice', parseFloat(e.target.value) || 0)}
                          className="input-base text-xs py-1.5 text-right" />
                      </td>
                      <td className="px-2 py-2 w-20">
                        <input type="number" min="0" max="100" value={line.taxRate}
                          onChange={e => updateLine(idx, 'taxRate', parseFloat(e.target.value) || 0)}
                          className="input-base text-xs py-1.5 text-right" />
                      </td>
                      <td className="px-3 py-2 text-right text-sm font-semibold text-slate-700 tabular whitespace-nowrap">
                        {formatCurrency(line.quantity * line.unitPrice * (1 + line.taxRate / 100))}
                      </td>
                      <td className="px-2 py-2 text-center">
                        <button onClick={() => setForm(f => ({ ...f, lines: f.lines.filter((_, i) => i !== idx) }))}
                          className="w-6 h-6 rounded-lg bg-red-50 text-red-400 hover:bg-red-100 hover:text-red-600 flex items-center justify-center transition-colors text-base leading-none">
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {/* Totals */}
              <div className="bg-slate-50 border-t border-slate-200 px-4 py-3 flex flex-col items-end gap-1">
                <div className="flex gap-8 text-sm">
                  <span className="text-slate-500">Subtotal:</span>
                  <span className="font-medium text-slate-700 tabular w-28 text-right">{formatCurrency(subtotal)}</span>
                </div>
                <div className="flex gap-8 text-sm">
                  <span className="text-slate-500">VAT:</span>
                  <span className="font-medium text-slate-700 tabular w-28 text-right">{formatCurrency(taxAmount)}</span>
                </div>
                <div className="flex gap-8 text-base font-bold border-t border-slate-200 pt-1 mt-1">
                  <span className="text-slate-800">Total:</span>
                  <span className="text-indigo-600 tabular w-28 text-right">{formatCurrency(total)}</span>
                </div>
              </div>
            </div>
            <button
              onClick={() => setForm(f => ({ ...f, lines: [...f.lines, { ...EMPTY_LINE }] }))}
              className="mt-2 flex items-center gap-1.5 text-sm text-indigo-600 hover:text-indigo-800 font-medium"
            >
              <Plus size={14} /> Add Line Item
            </button>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Textarea label="Notes" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} placeholder="Payment terms, notes..." />
            <div className="space-y-3">
              <Input label="Terms" value={form.terms} onChange={e => setForm({ ...form, terms: e.target.value })} />
              <label className="flex items-center gap-2.5 cursor-pointer group mt-1">
                <input type="checkbox" checked={form.isRecurring} onChange={e => setForm({ ...form, isRecurring: e.target.checked })}
                  className="w-4 h-4 rounded border-slate-300 text-indigo-600" />
                <span className="text-sm text-slate-600 group-hover:text-slate-800">Recurring Invoice</span>
              </label>
            </div>
          </div>
        </div>
      </Modal>

      {/* Invoice View + ZATCA Modal */}
      <Modal
        open={showViewModal}
        onClose={() => setShowViewModal(false)}
        title={selectedInvoice ? selectedInvoice.invoiceNo : 'Invoice'}
        subtitle={selectedInvoice ? selectedInvoice.customer.name : ''}
        size="md"
        footer={
          <>
            <Button variant="outline" onClick={() => setShowViewModal(false)}>Close</Button>
            {zatcaStatus?.canSubmit && (
              <Button onClick={handleZatcaSubmit} loading={submittingZatca}>
                <Shield size={14} /> Submit to ZATCA
              </Button>
            )}
          </>
        }
      >
        {selectedInvoice && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><p className="text-xs text-slate-400">Date</p><p className="font-medium">{formatDate(selectedInvoice.date)}</p></div>
              <div><p className="text-xs text-slate-400">Due</p><p className="font-medium">{formatDate(selectedInvoice.dueDate)}</p></div>
              <div><p className="text-xs text-slate-400">Total</p><p className="font-semibold text-indigo-600">{formatCurrency(selectedInvoice.total)}</p></div>
              <div><p className="text-xs text-slate-400">Balance</p><p className="font-medium">{formatCurrency(selectedInvoice.balance)}</p></div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Shield size={16} className="text-emerald-600" />
                <h3 className="font-semibold text-slate-800">ZATCA E-Invoicing</h3>
              </div>
              {zatcaStatus ? (
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-slate-400">ZATCA Status</p>
                    <p className="font-medium">{zatcaStatus.zatcaStatus}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Last Submission</p>
                    <p className="font-medium">{zatcaStatus.submittedAt ? formatDate(zatcaStatus.submittedAt) : '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Request ID</p>
                    <p className="font-mono text-xs break-all">{zatcaStatus.requestId ?? '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Clearance / Reporting</p>
                    <p className="font-medium">{zatcaStatus.clearanceStatus ?? zatcaStatus.responseCode ?? '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Response Code</p>
                    <p className="font-medium">{zatcaStatus.responseCode ?? '—'}</p>
                  </div>
                  {zatcaStatus.responseMessage && (
                    <div className="col-span-2">
                      <p className="text-xs text-slate-400">Response Message</p>
                      <p className="text-sm text-slate-600">{zatcaStatus.responseMessage}</p>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-slate-500">Loading ZATCA status...</p>
              )}
              <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-200">
                <Button variant="outline" size="sm" onClick={() => openArtifact('xml')}>View XML</Button>
                <Button variant="outline" size="sm" onClick={() => openArtifact('signed-xml')}>View Signed XML</Button>
                <Button variant="outline" size="sm" onClick={() => openArtifact('qr')}>View QR</Button>
              </div>
              {qrPreview && (
                <div className="pt-2">
                  <p className="text-xs text-slate-400 mb-2">QR Code</p>
                  <img src={qrPreview} alt="ZATCA QR" className="w-32 h-32 border border-slate-200 rounded-lg" />
                </div>
              )}
              {zatcaMsg && <p className="text-sm text-emerald-600">{zatcaMsg}</p>}
              {zatcaErr && <p className="text-sm text-red-600">{zatcaErr}</p>}
            </div>
          </div>
        )}
      </Modal>

      {/* Payment Modal */}
      <Modal
        open={showPayModal}
        onClose={() => setShowPayModal(false)}
        title="Record Payment"
        subtitle={selectedInvoice ? `${selectedInvoice.invoiceNo} · Balance: ${formatCurrency(selectedInvoice.balance)}` : ''}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setShowPayModal(false)}>Cancel</Button>
            <Button variant="success" onClick={handlePayment}>
              <DollarSign size={14} /> Record Payment
            </Button>
          </>
        }
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
          <Input label="Reference" value={payForm.reference} onChange={e => setPayForm({ ...payForm, reference: e.target.value })} placeholder="Transaction ID..." />
        </div>
      </Modal>
    </div>
  )
}
