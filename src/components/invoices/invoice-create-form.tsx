'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Paperclip, Trash2, Download } from 'lucide-react'
import { Input, Select, Textarea } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ALLOWED_CURRENCIES } from '@/lib/currency/constants'
import { calculateInvoiceTotals, type InvoiceTaxCalculationMethod } from '@/lib/invoices/calculations'
import {
  PAYMENT_TERM_PRESETS,
  computeDueDate,
  matchPresetFromTerms,
  parsePaymentTermsDays,
  resolvePaymentTermDays,
  toDateInputValue,
  type PaymentTermPresetKey,
} from '@/lib/invoices/payment-terms'
import { todayDateString, isFutureInvoiceDate } from '@/lib/ui/invoice-status'
import { formatCurrency as formatAmount } from '@/lib/utils'

export interface InvoiceFormLine {
  itemName: string
  description: string
  projectId: string
  classId: string
  projectService: string
  className: string
  quantity: number
  unitPrice: number
  taxRate: number
  taxRateId: string
  accountId: string
  inventoryItemId?: string
}

export interface InvoiceFormState {
  customerId: string
  date: string
  dueDate: string
  expiryDate: string
  notes: string
  terms: string
  paymentTermId: string
  taxCalculationMethod: InvoiceTaxCalculationMethod
  isRecurring: boolean
  currency: string
  lines: InvoiceFormLine[]
}

export interface TaxConfigOption {
  id: string
  name: string
  category: string
  zatcaMapping: string
  percentage: number
  isDefault?: boolean
}

export interface InvoiceAttachmentView {
  id: string
  originalFilename: string
  mimeType: string
  fileSize: number
}

export const EMPTY_INVOICE_LINE: InvoiceFormLine = {
  itemName: '',
  description: '',
  projectId: '',
  classId: '',
  projectService: '',
  className: '',
  quantity: 1,
  unitPrice: 0,
  taxRate: 15,
  taxRateId: '',
  accountId: '',
}

interface Customer { id: string; name: string }
interface Account { id: string; accountNo: string; name: string }
interface CostCenter { id: string; code: string; name: string; type: string }
interface PaymentTerm { id: string; name: string; days: number }

interface Props {
  form: InvoiceFormState
  setForm: React.Dispatch<React.SetStateAction<InvoiceFormState>>
  customers: Customer[]
  accounts: Account[]
  primaryCurrency: string
  formDateError: string | null
  setFormDateError: (v: string | null) => void
  invoiceId: string | null
  dueDateManuallyEdited: boolean
  setDueDateManuallyEdited: (v: boolean) => void
}

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

export function InvoiceCreateForm({
  form,
  setForm,
  customers,
  accounts,
  primaryCurrency,
  formDateError,
  setFormDateError,
  invoiceId,
  dueDateManuallyEdited,
  setDueDateManuallyEdited,
}: Props) {
  const [taxConfigs, setTaxConfigs] = useState<TaxConfigOption[]>([])
  const [projects, setProjects] = useState<CostCenter[]>([])
  const [classes, setClasses] = useState<CostCenter[]>([])
  const [paymentTerms, setPaymentTerms] = useState<PaymentTerm[]>([])
  const [termPreset, setTermPreset] = useState<PaymentTermPresetKey>('NET_30')
  const [attachments, setAttachments] = useState<InvoiceAttachmentView[]>([])
  const [uploading, setUploading] = useState(false)
  const [showTaxCreate, setShowTaxCreate] = useState(false)
  const [newTax, setNewTax] = useState({
    name: '',
    category: 'VAT',
    zatcaMapping: 'STANDARD_RATED',
    percentage: 15,
  })
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    async function loadLookups() {
      const [taxRes, projectRes, classRes, termsRes] = await Promise.all([
        fetch('/api/tax-configurations'),
        fetch('/api/cost-centers?type=PROJECT&activeOnly=true'),
        fetch('/api/cost-centers?type=CLASS&activeOnly=true'),
        fetch('/api/master-data/payment_terms'),
      ])
      if (taxRes.ok) {
        const taxes = await taxRes.json()
        setTaxConfigs(taxes)
        const defaultTax = taxes.find((t: TaxConfigOption) => t.isDefault) ?? taxes[0]
        if (defaultTax) {
          setForm((f) => ({
            ...f,
            lines: f.lines.map((line) =>
              line.taxRateId
                ? line
                : {
                    ...line,
                    taxRateId: defaultTax.id,
                    taxRate: defaultTax.percentage,
                  },
            ),
          }))
        }
      }
      if (projectRes.ok) setProjects(await projectRes.json())
      if (classRes.ok) setClasses(await classRes.json())
      if (termsRes.ok) {
        const rows = await termsRes.json()
        setPaymentTerms(
          (rows as Array<{ id: string; name: string; days: number }>).map((r) => ({
            id: r.id,
            name: r.name,
            days: Number(r.days ?? 30),
          })),
        )
      }
    }
    loadLookups()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    setTermPreset(matchPresetFromTerms(form.terms))
  }, [])

  useEffect(() => {
    if (!invoiceId) {
      setAttachments([])
      return
    }
    fetch(`/api/invoices/${invoiceId}/attachments`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setAttachments)
      .catch(() => setAttachments([]))
  }, [invoiceId])

  function applyDueDateFromTerms(nextDate: string, nextTerms: string, paymentTermId?: string) {
    if (dueDateManuallyEdited) return
    const term = paymentTerms.find((t) => t.id === (paymentTermId ?? form.paymentTermId))
    const days = resolvePaymentTermDays({
      paymentTermDays: term?.days,
      termsText: nextTerms,
      presetKey: termPreset === 'OTHER' ? 'OTHER' : termPreset,
    })
    setForm((f) => ({
      ...f,
      dueDate: toDateInputValue(computeDueDate(nextDate || f.date, days)),
    }))
  }

  function updateLine(idx: number, patch: Partial<InvoiceFormLine>) {
    setForm((f) => ({
      ...f,
      lines: f.lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)),
    }))
  }

  function onTaxSelect(idx: number, taxRateId: string) {
    const tax = taxConfigs.find((t) => t.id === taxRateId)
    updateLine(idx, {
      taxRateId,
      taxRate: tax?.percentage ?? 0,
    })
  }

  async function createTaxConfig() {
    const res = await fetch('/api/tax-configurations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newTax),
    })
    if (!res.ok) {
      alert(await res.text())
      return
    }
    const created = await res.json()
    setTaxConfigs((list) => [...list, created])
    setShowTaxCreate(false)
    setNewTax({ name: '', category: 'VAT', zatcaMapping: 'STANDARD_RATED', percentage: 15 })
  }

  async function uploadFiles(files: FileList | null) {
    if (!files?.length || !invoiceId) {
      if (!invoiceId) alert('Save the invoice as a draft first, then attach files.')
      return
    }
    setUploading(true)
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData()
        fd.append('file', file)
        const res = await fetch(`/api/invoices/${invoiceId}/attachments`, {
          method: 'POST',
          body: fd,
        })
        if (!res.ok) {
          alert(await res.text())
          continue
        }
        const created = await res.json()
        setAttachments((list) => [created, ...list])
      }
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function deleteAttachment(attachmentId: string) {
    if (!invoiceId) return
    const res = await fetch(`/api/invoices/${invoiceId}/attachments/${attachmentId}`, {
      method: 'DELETE',
    })
    if (!res.ok) {
      alert(await res.text())
      return
    }
    setAttachments((list) => list.filter((a) => a.id !== attachmentId))
  }

  const totals = useMemo(
    () =>
      calculateInvoiceTotals(
        form.lines.map((l) => ({
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          taxRate: l.taxRate,
        })),
        form.taxCalculationMethod,
      ),
    [form.lines, form.taxCalculationMethod],
  )

  const formatFormAmount = (amount: number) => formatAmount(amount, form.currency)

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Invoice Information</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Select
            label="Customer"
            required
            value={form.customerId}
            onChange={(e) => setForm({ ...form, customerId: e.target.value })}
          >
            <option value="">Select customer...</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
          <Input
            label="Invoice Date"
            type="date"
            required
            max={todayDateString()}
            value={form.date}
            error={formDateError ?? undefined}
            onChange={(e) => {
              const nextDate = e.target.value
              setFormDateError(isFutureInvoiceDate(nextDate) ? 'Invoice date cannot be in the future.' : null)
              setForm((f) => ({ ...f, date: nextDate }))
              applyDueDateFromTerms(nextDate, form.terms, form.paymentTermId)
            }}
          />
          <div className="space-y-1.5">
            <Select
              label="Payment Terms"
              value={termPreset}
              onChange={(e) => {
                const key = e.target.value as PaymentTermPresetKey
                setTermPreset(key)
                setDueDateManuallyEdited(false)
                if (key === 'OTHER') {
                  setForm((f) => ({ ...f, paymentTermId: '', terms: f.terms || '' }))
                  return
                }
                const preset = PAYMENT_TERM_PRESETS.find((p) => p.key === key)
                const master = paymentTerms.find(
                  (t) => t.name.toLowerCase() === preset?.label.toLowerCase(),
                )
                const termsLabel = preset?.label ?? 'Net 30'
                setForm((f) => ({
                  ...f,
                  terms: termsLabel,
                  paymentTermId: master?.id ?? '',
                  dueDate: toDateInputValue(computeDueDate(f.date, preset?.days ?? 30)),
                }))
              }}
            >
              {PAYMENT_TERM_PRESETS.map((p) => (
                <option key={p.key} value={p.key}>{p.label}</option>
              ))}
              <option value="OTHER">Other...</option>
            </Select>
            {termPreset === 'OTHER' && (
              <Input
                label="Custom Terms"
                value={form.terms}
                placeholder="e.g. Net 45"
                onChange={(e) => {
                  const text = e.target.value
                  setDueDateManuallyEdited(false)
                  const days = parsePaymentTermsDays(text)
                  setForm((f) => ({
                    ...f,
                    terms: text,
                    paymentTermId: '',
                    dueDate:
                      days != null
                        ? toDateInputValue(computeDueDate(f.date, days))
                        : f.dueDate,
                  }))
                }}
              />
            )}
          </div>
          <Input
            label="Due Date"
            type="date"
            required
            value={form.dueDate}
            hint="Auto-calculated from terms; you can override"
            onChange={(e) => {
              setDueDateManuallyEdited(true)
              setForm({ ...form, dueDate: e.target.value })
            }}
          />
          <Input
            label="Expiry Date"
            type="date"
            value={form.expiryDate}
            min={form.date}
            onChange={(e) => setForm({ ...form, expiryDate: e.target.value })}
          />
          <Select
            label="Tax Calculation Method"
            value={form.taxCalculationMethod}
            onChange={(e) =>
              setForm({
                ...form,
                taxCalculationMethod: e.target.value as InvoiceTaxCalculationMethod,
              })
            }
          >
            <option value="TAX_EXCLUSIVE">Tax Exclusive</option>
            <option value="TAX_INCLUSIVE">Tax Inclusive</option>
            <option value="OUT_OF_SCOPE">Out of Scope of Tax</option>
          </Select>
          <Select
            label="Currency"
            required
            value={form.currency}
            onChange={(e) => setForm({ ...form, currency: e.target.value })}
          >
            {ALLOWED_CURRENCIES.map((entry) => (
              <option key={entry.code} value={entry.code}>
                {entry.code} — {entry.name}
              </option>
            ))}
          </Select>
        </div>
        <p className="text-xs text-slate-400">
          Defaults to your company primary currency ({primaryCurrency}). Changing this affects only this invoice.
        </p>
      </section>

      <section>
        <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-600">
          Line Items
        </label>
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full min-w-[960px]">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                {['Item', 'Description', 'Project / Service', 'Class', 'Qty', 'Unit Price', 'Tax', 'Amount', ''].map(
                  (h, i) => (
                    <th
                      key={i}
                      className="px-2 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500"
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {form.lines.map((line, idx) => {
                const lineCalc = totals.lines[idx]
                return (
                  <tr key={idx}>
                    <td className="px-2 py-2">
                      <input
                        value={line.itemName}
                        onChange={(e) => updateLine(idx, { itemName: e.target.value })}
                        placeholder="Item"
                        className="input-base py-1.5 text-xs"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        value={line.description}
                        onChange={(e) => updateLine(idx, { description: e.target.value })}
                        placeholder="Description"
                        className="input-base py-1.5 text-xs"
                      />
                    </td>
                    <td className="px-2 py-2 min-w-[140px]">
                      <select
                        value={line.projectId}
                        onChange={(e) => {
                          const project = projects.find((p) => p.id === e.target.value)
                          updateLine(idx, {
                            projectId: e.target.value,
                            projectService: project?.name ?? '',
                          })
                        }}
                        className="input-base bg-white py-1.5 text-xs"
                      >
                        <option value="">— Select project —</option>
                        {projects.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-2 min-w-[140px]">
                      <select
                        value={line.classId}
                        onChange={(e) => {
                          const cls = classes.find((c) => c.id === e.target.value)
                          updateLine(idx, {
                            classId: e.target.value,
                            className: cls?.name ?? '',
                          })
                        }}
                        className="input-base bg-white py-1.5 text-xs"
                      >
                        <option value="">— Select class —</option>
                        {classes.map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="w-20 px-2 py-2">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={line.quantity}
                        onChange={(e) => updateLine(idx, { quantity: parseFloat(e.target.value) || 0 })}
                        className="input-base py-1.5 text-right text-xs"
                      />
                    </td>
                    <td className="w-28 px-2 py-2">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={line.unitPrice}
                        onChange={(e) => updateLine(idx, { unitPrice: parseFloat(e.target.value) || 0 })}
                        className="input-base py-1.5 text-right text-xs"
                      />
                    </td>
                    <td className="min-w-[140px] px-2 py-2">
                      <select
                        value={line.taxRateId}
                        onChange={(e) => onTaxSelect(idx, e.target.value)}
                        className="input-base bg-white py-1.5 text-xs"
                        disabled={form.taxCalculationMethod === 'OUT_OF_SCOPE'}
                      >
                        <option value="">—</option>
                        {taxConfigs.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name} ({t.percentage}%)
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-sm font-semibold tabular text-slate-700">
                      {formatFormAmount(lineCalc?.lineTotal ?? 0)}
                    </td>
                    <td className="px-2 py-2 text-center">
                      <button
                        type="button"
                        onClick={() =>
                          setForm((f) => ({
                            ...f,
                            lines: f.lines.filter((_, i) => i !== idx),
                          }))
                        }
                        className="flex h-6 w-6 items-center justify-center rounded-lg bg-red-50 text-base leading-none text-red-400 transition-colors hover:bg-red-100 hover:text-red-600"
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="flex flex-col items-end gap-1 border-t border-slate-200 bg-slate-50 px-4 py-3">
            <div className="flex gap-8 text-sm">
              <span className="text-slate-500">Subtotal:</span>
              <span className="w-28 text-right font-medium tabular text-slate-700">
                {formatFormAmount(totals.subtotal)}
              </span>
            </div>
            <div className="flex gap-8 text-sm">
              <span className="text-slate-500">Tax:</span>
              <span className="w-28 text-right font-medium tabular text-slate-700">
                {formatFormAmount(totals.taxAmount)}
              </span>
            </div>
            <div className="mt-1 flex gap-8 border-t border-slate-200 pt-1 text-base font-bold">
              <span className="text-slate-800">Total:</span>
              <span className="w-28 text-right tabular text-indigo-600">
                {formatFormAmount(totals.total)}
              </span>
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() =>
            setForm((f) => ({
              ...f,
              lines: [
                ...f.lines,
                {
                  ...EMPTY_INVOICE_LINE,
                  taxRateId: taxConfigs.find((t) => t.isDefault)?.id ?? taxConfigs[0]?.id ?? '',
                  taxRate: taxConfigs.find((t) => t.isDefault)?.percentage ?? taxConfigs[0]?.percentage ?? 15,
                },
              ],
            }))
          }
          className="mt-2 flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:text-indigo-800"
        >
          <Plus size={14} /> Add Line Item
        </button>
      </section>

      <section className="space-y-3 rounded-xl border border-slate-200 p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Tax Configuration</h3>
          <button
            type="button"
            className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
            onClick={() => setShowTaxCreate((v) => !v)}
          >
            {showTaxCreate ? 'Cancel' : '+ Create Tax'}
          </button>
        </div>
        {showTaxCreate && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <Input label="Tax Name" value={newTax.name} onChange={(e) => setNewTax({ ...newTax, name: e.target.value })} />
            <Select label="Category" value={newTax.category} onChange={(e) => setNewTax({ ...newTax, category: e.target.value })}>
              {['VAT', 'Sales Tax', 'General Tax', 'Withholding Tax', 'Zero Rated', 'Exempt'].map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </Select>
            <Select
              label="ZATCA Mapping"
              value={newTax.zatcaMapping}
              onChange={(e) => setNewTax({ ...newTax, zatcaMapping: e.target.value })}
            >
              <option value="STANDARD_RATED">Standard Rated</option>
              <option value="ZERO_RATED">Zero Rated</option>
              <option value="EXEMPT">Exempt</option>
              <option value="OUTSIDE_SCOPE">Outside Scope</option>
            </Select>
            <Input
              label="Percentage"
              type="number"
              min={0}
              max={100}
              value={newTax.percentage}
              onChange={(e) => setNewTax({ ...newTax, percentage: parseFloat(e.target.value) || 0 })}
            />
            <div className="sm:col-span-4">
              <Button type="button" size="sm" onClick={createTaxConfig}>Save Tax Configuration</Button>
            </div>
          </div>
        )}
        <p className="text-xs text-slate-400">
          Line tax uses the selected configuration. ZATCA mapping is stored for Phase 2 XML generation.
        </p>
      </section>

      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Attachments</h3>
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.doc,.docx,.xls,.xlsx,.csv,.txt"
            onChange={(e) => uploadFiles(e.target.files)}
          />
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-2 text-sm font-medium text-indigo-600 hover:text-indigo-800 disabled:opacity-50"
          >
            <Paperclip size={14} />
            {invoiceId ? (uploading ? 'Uploading…' : 'Upload files') : 'Save draft to enable uploads'}
          </button>
          {attachments.length > 0 && (
            <ul className="mt-3 space-y-2">
              {attachments.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                >
                  <div>
                    <p className="font-medium text-slate-700">{a.originalFilename}</p>
                    <p className="text-xs text-slate-400">
                      {a.mimeType} · {formatBytes(a.fileSize)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {invoiceId && (
                      <a
                        href={`/api/invoices/${invoiceId}/attachments/${a.id}`}
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                        title="Download"
                      >
                        <Download size={14} />
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => deleteAttachment(a.id)}
                      className="rounded-lg p-1.5 text-red-400 hover:bg-red-50 hover:text-red-600"
                      title="Delete"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Textarea
          label="Notes"
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          rows={2}
          placeholder="Notes..."
        />
        <div className="space-y-3">
          <label className="mt-1 flex cursor-pointer items-center gap-2.5 group">
            <input
              type="checkbox"
              checked={form.isRecurring}
              onChange={(e) => setForm({ ...form, isRecurring: e.target.checked })}
              className="h-4 w-4 rounded border-slate-300 text-indigo-600"
            />
            <span className="text-sm text-slate-600 group-hover:text-slate-800">Recurring Invoice</span>
          </label>
        </div>
      </div>
    </div>
  )
}
