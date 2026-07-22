'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Hash, RotateCcw, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import { readApiError } from '@/lib/api-client'
import { previewDocumentNumber } from '@/lib/document-numbering/format'

interface InvoiceNumberingState {
  prefix: string
  startingNumber: number
  nextNumber: number
  padding: number
  suffix: string
  minNextNumber: number
  hasInvoices: boolean
  lastIssuedInvoiceNo: string | null
}

const DEFAULT_STATE: InvoiceNumberingState = {
  prefix: 'INV-',
  startingNumber: 1,
  nextNumber: 1,
  padding: 6,
  suffix: '',
  minNextNumber: 1,
  hasInvoices: false,
  lastIssuedInvoiceNo: null,
}

export default function DocumentNumberingSettingsPage() {
  const [form, setForm] = useState<InvoiceNumberingState>(DEFAULT_STATE)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/settings/document-numbering')
      if (!res.ok) throw new Error(await readApiError(res))
      const data = await res.json()
      const invoice = data.invoice
      if (invoice) {
        setForm({
          prefix: invoice.prefix ?? 'INV-',
          startingNumber: Number(invoice.startingNumber ?? 1),
          nextNumber: Number(invoice.nextNumber ?? 1),
          padding: Number(invoice.padding ?? 6),
          suffix: invoice.suffix ?? '',
          minNextNumber: Number(invoice.minNextNumber ?? 1),
          hasInvoices: Boolean(invoice.hasInvoices),
          lastIssuedInvoiceNo: invoice.lastIssuedInvoiceNo ?? null,
        })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load numbering settings')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const livePreview = useMemo(
    () =>
      previewDocumentNumber({
        prefix: form.prefix,
        nextNumber: form.nextNumber,
        padding: form.padding,
        suffix: form.suffix,
      }),
    [form.prefix, form.nextNumber, form.padding, form.suffix],
  )

  async function handleSave() {
    setSaving(true)
    setSaved(false)
    setError(null)
    try {
      const res = await fetch('/api/settings/document-numbering', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentType: 'INVOICE',
          action: 'save',
          prefix: form.prefix,
          // Starting number is informational once invoices exist — keep stored value
          startingNumber: form.startingNumber,
          nextNumber: form.nextNumber,
          padding: form.padding,
          suffix: form.suffix,
        }),
      })
      if (!res.ok) throw new Error(await readApiError(res))
      setSaved(true)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  async function handleReset() {
    setSaving(true)
    setSaved(false)
    setError(null)
    try {
      const res = await fetch('/api/settings/document-numbering', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentType: 'INVOICE', action: 'reset' }),
      })
      if (!res.ok) throw new Error(await readApiError(res))
      await load()
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <PageHeader
        title="Document Numbering"
        subtitle="Configure invoice number prefix, sequence, and padding for your company"
        breadcrumb={[
          { label: 'Administration' },
          { label: 'Settings', href: '/settings' },
          { label: 'Document Numbering' },
        ]}
        action={
          <div className="flex items-center gap-2">
            <Link href="/settings" className="text-sm text-indigo-600 hover:underline">
              ← Settings
            </Link>
            <Button variant="outline" onClick={() => void handleReset()} disabled={saving || loading}>
              <RotateCcw size={14} /> Reset
            </Button>
            <Button onClick={() => void handleSave()} loading={saving} disabled={loading}>
              <Save size={14} /> Save
            </Button>
          </div>
        }
      />

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {saved && !error && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          Numbering settings saved. Future invoices will use the updated sequence.
        </div>
      )}

      <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50">
            <Hash size={18} className="text-indigo-600" />
          </div>
          <div>
            <h2 className="font-semibold text-slate-900">Invoice Numbering</h2>
            <p className="text-xs text-slate-400">
              Existing invoices keep their numbers. Only new invoices use this sequence.
            </p>
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : (
          <>
            <Input
              label="Prefix"
              required
              value={form.prefix}
              maxLength={20}
              onChange={(e) => setForm((f) => ({ ...f, prefix: e.target.value }))}
              hint="Text before the number, e.g. INV-"
            />

            <Input
              label="Starting Number"
              type="number"
              min={1}
              max={999999999}
              value={form.startingNumber}
              disabled={form.hasInvoices}
              onChange={(e) => {
                if (form.hasInvoices) return
                const parsed = parseInt(e.target.value, 10)
                setForm((f) => ({
                  ...f,
                  startingNumber: Number.isFinite(parsed) && parsed > 0 ? parsed : 1,
                }))
              }}
              hint={
                form.hasInvoices
                  ? 'Starting Number is only used when creating a new numbering sequence. To continue numbering, update the Next Invoice Number.'
                  : 'Initial reference for this series when no invoices exist yet'
              }
            />

            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Last Issued Invoice
              </p>
              <p className="mt-1 font-mono text-lg font-semibold text-slate-800">
                {form.lastIssuedInvoiceNo ?? '—'}
              </p>
              <p className="mt-1 text-xs text-slate-400">
                {form.lastIssuedInvoiceNo
                  ? 'Most recent invoice number for this prefix (read-only).'
                  : 'No invoices have been issued yet for this prefix.'}
              </p>
            </div>

            <Input
              label="Next Invoice Number"
              type="number"
              min={1}
              max={999999999}
              value={form.nextNumber}
              onChange={(e) => {
                const parsed = parseInt(e.target.value, 10)
                setForm((f) => ({
                  ...f,
                  nextNumber: Number.isFinite(parsed) && parsed > 0 ? parsed : 1,
                }))
              }}
              hint="The next invoice you create will receive this number. The system increments it automatically after each invoice. Existing invoices are never renumbered."
            />

            <Select
              label="Padding"
              value={String(form.padding)}
              onChange={(e) =>
                setForm((f) => ({ ...f, padding: Number(e.target.value) }))
              }
            >
              {Array.from({ length: 11 }, (_, i) => (
                <option key={i} value={i}>
                  {i === 0 ? '0 — no padding (INV-91)' : `${i} digits (INV-${String(1).padStart(i, '0')})`}
                </option>
              ))}
            </Select>

            <Input
              label="Suffix (optional)"
              value={form.suffix}
              maxLength={20}
              onChange={(e) => setForm((f) => ({ ...f, suffix: e.target.value }))}
              placeholder="Leave blank"
            />

            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Preview
              </p>
              <p className="mt-2 font-mono text-2xl font-semibold tracking-wide text-indigo-700">
                {livePreview || '—'}
              </p>
              <p className="mt-1 text-xs text-slate-400">
                The next invoice you create will receive this number.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
