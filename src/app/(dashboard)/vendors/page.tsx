'use client'

import { useEffect, useState } from 'react'
import { Plus, RefreshCw, Mail, Phone, Edit2, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { Input } from '@/components/ui/input'
import { PageHeader, SearchBar, FilterBar } from '@/components/ui/page-header'
import { readApiError } from '@/lib/api-client'

interface Vendor {
  id: string; vendorNo: string; name: string; email?: string; phone?: string
  city?: string; country?: string; taxId?: string; paymentTerms: number; isActive: boolean
}

export default function VendorsPage() {
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<Vendor | null>(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', phone: '', address: '', city: '', country: 'Saudi Arabia', taxId: '', paymentTerms: 30 })

  async function load() {
    setLoading(true)
    const params = new URLSearchParams()
    if (search) params.set('search', search)
    const res = await fetch(`/api/vendors?${params}`)
    if (res.ok) setVendors(await res.json())
    setLoading(false)
  }

  useEffect(() => { load() }, [search])

  function openCreate() {
    setEditing(null)
    setForm({ name: '', email: '', phone: '', address: '', city: '', country: 'Saudi Arabia', taxId: '', paymentTerms: 30 })
    setShowModal(true)
  }

  function openEdit(v: Vendor) {
    setEditing(v)
    setForm({ name: v.name, email: v.email || '', phone: v.phone || '', address: '', city: v.city || '', country: v.country || 'Saudi Arabia', taxId: v.taxId || '', paymentTerms: v.paymentTerms })
    setShowModal(true)
  }

  async function handleSave() {
    setSaving(true)
    const url = editing ? `/api/vendors/${editing.id}` : '/api/vendors'
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
    if (!confirm('Delete this vendor?')) return
    const res = await fetch(`/api/vendors/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      alert(await readApiError(res))
      return
    }
    load()
  }

  return (
    <div className="p-6 max-w-[1600px] mx-auto space-y-5">
      <PageHeader
        title="Vendors & Suppliers"
        subtitle={`${vendors.length} vendors`}
        breadcrumb={[{ label: 'Expenses' }, { label: 'Vendors' }]}
        action={<Button onClick={openCreate}><Plus size={15} /> New Vendor</Button>}
      />

      <FilterBar>
        <SearchBar value={search} onChange={setSearch} placeholder="Search vendors..." className="flex-1 max-w-sm" />
        <button onClick={load} className="p-2 border border-slate-200 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-50 bg-white transition-colors">
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
        </button>
      </FilterBar>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full data-table">
            <thead>
              <tr className="border-b border-slate-100">
                {['#', 'Name', 'Contact', 'City', 'Tax ID', 'Terms', 'Status', ''].map((h, i) => (
                  <th key={i} className={cn('px-4 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wider text-left', h === 'Status' && 'text-center', h === '' && 'w-20')}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {loading ? Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>{Array.from({ length: 8 }).map((_, j) => <td key={j} className="px-4 py-3"><div className="skeleton h-4 rounded" /></td>)}</tr>
              )) : vendors.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-16 text-center text-slate-400 text-sm">No vendors yet.</td></tr>
              ) : vendors.map(v => (
                <tr key={v.id} className="hover:bg-slate-50/60 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{v.vendorNo}</td>
                  <td className="px-4 py-3 font-semibold text-slate-800">{v.name}</td>
                  <td className="px-4 py-3">
                    <div className="space-y-0.5">
                      {v.email && <div className="flex items-center gap-1.5 text-xs text-slate-500"><Mail size={10} />{v.email}</div>}
                      {v.phone && <div className="flex items-center gap-1.5 text-xs text-slate-500"><Phone size={10} />{v.phone}</div>}
                      {!v.email && !v.phone && <span className="text-slate-300 text-xs">—</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600">{v.city || '—'}</td>
                  <td className="px-4 py-3 text-xs font-mono text-slate-500">{v.taxId || '—'}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">Net {v.paymentTerms}d</td>
                  <td className="px-4 py-3 text-center">
                    <span className={cn('badge', v.isActive ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-gray-50 text-gray-500 border border-gray-200')}>
                      {v.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button onClick={() => openEdit(v)} className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"><Edit2 size={13} /></button>
                      <button onClick={() => handleDelete(v.id)} className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"><Trash2 size={13} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)}
        title={editing ? 'Edit Vendor' : 'New Vendor'} size="md"
        footer={<><Button variant="outline" onClick={() => setShowModal(false)}>Cancel</Button><Button onClick={handleSave} loading={saving}>Save</Button></>}
      >
        <div className="space-y-4">
          <Input label="Vendor Name" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          <div className="grid grid-cols-2 gap-4">
            <Input label="Email" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
            <Input label="Phone" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label="City" value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} />
            <Input label="Country" value={form.country} onChange={e => setForm({ ...form, country: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label="Tax ID" value={form.taxId} onChange={e => setForm({ ...form, taxId: e.target.value })} />
            <Input label="Payment Terms (days)" type="number" value={form.paymentTerms} onChange={e => setForm({ ...form, paymentTerms: parseInt(e.target.value) || 30 })} />
          </div>
        </div>
      </Modal>
    </div>
  )
}
