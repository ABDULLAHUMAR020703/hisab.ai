'use client'

import { useEffect, useState } from 'react'
import { Plus, Edit2, Trash2, MapPin, Tag, Briefcase } from 'lucide-react'
import { cn, formatCurrency } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { Input, Select } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import { CostCenterImportToolbar } from '@/components/cost-centers/cost-center-import-toolbar'
import { readApiError } from '@/lib/api-client'
import { useCompanyCurrency } from '@/hooks/use-company-currency'

interface CostCenter {
  id: string
  code: string
  name: string
  type: string
  description?: string | null
  isActive: boolean
  cost?: number | null
  salesPrice?: number | null
  sku?: string | null
}

const typeIcons = { LOCATION: MapPin, CLASS: Tag, PROJECT: Briefcase }
const typeColors: Record<string, string> = {
  LOCATION: 'bg-sky-50 text-sky-700 border border-sky-200',
  CLASS: 'bg-violet-50 text-violet-700 border border-violet-200',
  PROJECT: 'bg-amber-50 text-amber-700 border border-amber-200',
}

export default function CostCentersPage() {
  const { currency } = useCompanyCurrency()
  const [items, setItems] = useState<CostCenter[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<CostCenter | null>(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    code: '',
    name: '',
    type: 'PROJECT',
    description: '',
    cost: '',
  })

  async function load() {
    setLoading(true)
    // includeCost derives Cost from PROJECT metadata for the table
    const res = await fetch('/api/cost-centers?includeCost=true')
    if (res.ok) setItems(await res.json())
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [])

  function openCreate() {
    setEditing(null)
    setForm({ code: '', name: '', type: 'PROJECT', description: '', cost: '' })
    setShowModal(true)
  }

  function openEdit(c: CostCenter) {
    setEditing(c)
    setForm({
      code: c.code,
      name: c.name,
      type: c.type,
      description: c.description || '',
      cost: c.type === 'PROJECT' && c.cost != null ? String(c.cost) : '',
    })
    setShowModal(true)
  }

  async function handleSave() {
    setSaving(true)
    const url = editing ? `/api/cost-centers/${editing.id}` : '/api/cost-centers'
    const payload: Record<string, unknown> = {
      code: form.code,
      name: form.name,
      type: form.type,
      description: form.description,
    }
    if (form.type === 'PROJECT') {
      payload.cost = form.cost.trim() === '' ? null : Number(form.cost)
    }
    const res = await fetch(url, {
      method: editing ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      alert(await readApiError(res))
      setSaving(false)
      return
    }
    setShowModal(false)
    await load()
    setSaving(false)
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this cost center?')) return
    const res = await fetch(`/api/cost-centers/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      alert(await readApiError(res))
      return
    }
    await load()
  }

  function formatCost(c: CostCenter) {
    if (c.type !== 'PROJECT') return '—'
    if (c.cost == null || Number.isNaN(Number(c.cost))) return '—'
    return formatCurrency(Number(c.cost), currency)
  }

  return (
    <div className="mx-auto max-w-[1600px] space-y-5 p-6">
      <PageHeader
        title="Cost Centers"
        subtitle="Track costs by location, class, or project"
        breadcrumb={[{ label: 'Operations' }, { label: 'Cost Centers' }]}
        action={(
          <div className="flex items-center gap-2">
            <CostCenterImportToolbar onImportSuccess={() => void load()} />
            <Button onClick={openCreate}><Plus size={15} /> New Cost Center</Button>
          </div>
        )}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {(['LOCATION', 'CLASS', 'PROJECT'] as const).map((type) => {
          const Icon = typeIcons[type]
          const count = items.filter((i) => i.type === type).length
          return (
            <div key={type} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className={cn('mb-3 flex h-10 w-10 items-center justify-center rounded-xl', typeColors[type].split(' ').slice(0, 2).join(' '))}>
                <Icon size={18} />
              </div>
              <p className="text-xs font-semibold uppercase text-slate-500">{type}</p>
              <p className="mt-0.5 text-2xl font-bold text-slate-900">{count}</p>
            </div>
          )
        })}
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="data-table w-full">
            <thead>
              <tr className="border-b border-slate-100">
                {['Code', 'Name', 'Type', 'Cost', 'Description', 'Status', ''].map((h, i) => (
                  <th
                    key={i}
                    className={cn(
                      'px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400',
                      h === 'Status' && 'text-center',
                      h === 'Cost' && 'text-right',
                      h === '' && 'w-20',
                    )}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 7 }).map((_, j) => (
                      <td key={j} className="px-4 py-3"><div className="skeleton h-4 rounded" /></td>
                    ))}
                  </tr>
                ))
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-sm text-slate-400">
                    No cost centers yet.
                  </td>
                </tr>
              ) : (
                items.map((c) => {
                  const Icon = typeIcons[c.type as keyof typeof typeIcons] || Briefcase
                  return (
                    <tr key={c.id} className="transition-colors hover:bg-slate-50/60">
                      <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-600">{c.code}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Icon size={14} className="flex-shrink-0 text-slate-400" />
                          <span className="text-sm font-semibold text-slate-800">{c.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn('badge', typeColors[c.type])}>{c.type}</span>
                      </td>
                      <td className="px-4 py-3 text-right text-sm font-medium tabular text-slate-700">
                        {formatCost(c)}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-500">{c.description || '—'}</td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={cn(
                            'badge',
                            c.isActive
                              ? 'border border-emerald-200 bg-emerald-50 text-emerald-700'
                              : 'border border-gray-200 bg-gray-50 text-gray-500',
                          )}
                        >
                          {c.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => openEdit(c)}
                            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
                          >
                            <Edit2 size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDelete(c.id)}
                            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title={editing ? 'Edit Cost Center' : 'New Cost Center'}
        size="sm"
        footer={(
          <>
            <Button variant="outline" onClick={() => setShowModal(false)}>Cancel</Button>
            <Button onClick={() => void handleSave()} loading={saving}>Save</Button>
          </>
        )}
      >
        <div className="space-y-4">
          <Input
            label="Code"
            required
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
            placeholder="RYD-01, CLS-A, PRJ-001..."
            disabled={!!editing}
          />
          <Input
            label="Name"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <Select
            label="Type"
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
            disabled={!!editing}
          >
            <option value="LOCATION">Location</option>
            <option value="CLASS">Class</option>
            <option value="PROJECT">Project</option>
          </Select>
          {form.type === 'PROJECT' && (
            <Input
              label="Cost"
              type="number"
              min="0"
              step="0.01"
              value={form.cost}
              onChange={(e) => setForm({ ...form, cost: e.target.value })}
              placeholder="Default unit cost for invoices"
              hint="Used as Unit Price when this Project/Service is selected on an invoice"
            />
          )}
          <Input
            label="Description"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </div>
      </Modal>
    </div>
  )
}
