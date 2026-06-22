'use client'

import { useEffect, useState } from 'react'
import { Plus, Edit2, Trash2, MapPin, Tag, Briefcase } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { Input, Select } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import { readApiError } from '@/lib/api-client'

interface CostCenter { id: string; code: string; name: string; type: string; description?: string; isActive: boolean }

const typeIcons = { LOCATION: MapPin, CLASS: Tag, PROJECT: Briefcase }
const typeColors: Record<string, string> = {
  LOCATION: 'bg-sky-50 text-sky-700 border border-sky-200',
  CLASS: 'bg-violet-50 text-violet-700 border border-violet-200',
  PROJECT: 'bg-amber-50 text-amber-700 border border-amber-200',
}

export default function CostCentersPage() {
  const [items, setItems] = useState<CostCenter[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<CostCenter | null>(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ code: '', name: '', type: 'PROJECT', description: '' })

  async function load() {
    setLoading(true)
    const res = await fetch('/api/cost-centers')
    if (res.ok) setItems(await res.json())
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function openCreate() {
    setEditing(null)
    setForm({ code: '', name: '', type: 'PROJECT', description: '' })
    setShowModal(true)
  }

  function openEdit(c: CostCenter) {
    setEditing(c)
    setForm({ code: c.code, name: c.name, type: c.type, description: c.description || '' })
    setShowModal(true)
  }

  async function handleSave() {
    setSaving(true)
    const url = editing ? `/api/cost-centers/${editing.id}` : '/api/cost-centers'
    const res = await fetch(url, { method: editing ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
    if (!res.ok) {
      alert(await readApiError(res))
      setSaving(false)
      return
    }
    if (res.ok) { setShowModal(false); load() }
    setSaving(false)
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this cost center?')) return
    const res = await fetch(`/api/cost-centers/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      alert(await readApiError(res))
      return
    }
    load()
  }

  return (
    <div className="p-6 max-w-[1600px] mx-auto space-y-5">
      <PageHeader
        title="Cost Centers"
        subtitle="Track costs by location, class, or project"
        breadcrumb={[{ label: 'Operations' }, { label: 'Cost Centers' }]}
        action={<Button onClick={openCreate}><Plus size={15} /> New Cost Center</Button>}
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {(['LOCATION', 'CLASS', 'PROJECT'] as const).map(type => {
          const Icon = typeIcons[type]
          const count = items.filter(i => i.type === type).length
          return (
            <div key={type} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
              <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center mb-3', typeColors[type].split(' ').slice(0, 2).join(' '))}>
                <Icon size={18} />
              </div>
              <p className="text-xs font-semibold text-slate-500 uppercase">{type}</p>
              <p className="text-2xl font-bold text-slate-900 mt-0.5">{count}</p>
            </div>
          )
        })}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full data-table">
            <thead>
              <tr className="border-b border-slate-100">
                {['Code', 'Name', 'Type', 'Description', 'Status', ''].map((h, i) => (
                  <th key={i} className={cn('px-4 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wider text-left', h === 'Status' && 'text-center', h === '' && 'w-20')}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {loading ? Array.from({ length: 4 }).map((_, i) => (
                <tr key={i}>{Array.from({ length: 6 }).map((_, j) => <td key={j} className="px-4 py-3"><div className="skeleton h-4 rounded" /></td>)}</tr>
              )) : items.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-slate-400 text-sm">No cost centers yet.</td></tr>
              ) : items.map(c => {
                const Icon = typeIcons[c.type as keyof typeof typeIcons] || Briefcase
                return (
                  <tr key={c.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-600">{c.code}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Icon size={14} className="text-slate-400 flex-shrink-0" />
                        <span className="font-semibold text-slate-800 text-sm">{c.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3"><span className={cn('badge', typeColors[c.type])}>{c.type}</span></td>
                    <td className="px-4 py-3 text-sm text-slate-500">{c.description || '—'}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={cn('badge', c.isActive ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-gray-50 text-gray-500 border border-gray-200')}>
                        {c.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button onClick={() => openEdit(c)} className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"><Edit2 size={13} /></button>
                        <button onClick={() => handleDelete(c.id)} className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"><Trash2 size={13} /></button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)}
        title={editing ? 'Edit Cost Center' : 'New Cost Center'} size="sm"
        footer={<><Button variant="outline" onClick={() => setShowModal(false)}>Cancel</Button><Button onClick={handleSave} loading={saving}>Save</Button></>}
      >
        <div className="space-y-4">
          <Input label="Code" required value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} placeholder="RYD-01, CLS-A, PRJ-001..." disabled={!!editing} />
          <Input label="Name" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          <Select label="Type" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
            <option value="LOCATION">Location</option>
            <option value="CLASS">Class</option>
            <option value="PROJECT">Project</option>
          </Select>
          <Input label="Description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
        </div>
      </Modal>
    </div>
  )
}
