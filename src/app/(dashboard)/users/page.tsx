'use client'

import { useEffect, useState } from 'react'
import { Plus, Edit2, UserX } from 'lucide-react'
import { formatDate, cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { Input, Select } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import { readApiError } from '@/lib/api-client'

interface User {
  id: string; name: string; email: string; role: string; isActive: boolean; createdAt: string
}

const ROLES = ['ADMIN', 'ACCOUNTANT', 'VIEWER']

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<User | null>(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'ACCOUNTANT' })

  async function load() {
    setLoading(true)
    const res = await fetch('/api/users')
    if (res.ok) setUsers(await res.json())
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function openCreate() {
    setEditing(null)
    setForm({ name: '', email: '', password: '', role: 'ACCOUNTANT' })
    setShowModal(true)
  }

  function openEdit(u: User) {
    setEditing(u)
    setForm({ name: u.name || '', email: u.email, password: '', role: u.role })
    setShowModal(true)
  }

  async function handleSave() {
    setSaving(true)
    const url = editing ? `/api/users/${editing.id}` : '/api/users'
    const body = editing ? { name: form.name, role: form.role } : form
    const res = await fetch(url, { method: editing ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (!res.ok) {
      alert(await readApiError(res))
      setSaving(false)
      return
    }
    if (res.ok) { setShowModal(false); load() }
    setSaving(false)
  }

  async function handleDeactivate(id: string) {
    if (!confirm('Deactivate this user?')) return
    const res = await fetch(`/api/users/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isActive: false }) })
    if (!res.ok) {
      alert(await readApiError(res))
      return
    }
    load()
  }

  const roleColors: Record<string, string> = {
    ADMIN: 'bg-violet-50 text-violet-700 border border-violet-200',
    ACCOUNTANT: 'bg-indigo-50 text-indigo-700 border border-indigo-200',
    VIEWER: 'bg-slate-50 text-slate-600 border border-slate-200',
  }

  return (
    <div className="p-6 max-w-[1600px] mx-auto space-y-5">
      <PageHeader
        title="User Management"
        subtitle={`${users.length} users`}
        breadcrumb={[{ label: 'Administration' }, { label: 'Users' }]}
        action={<Button onClick={openCreate}><Plus size={15} /> Invite User</Button>}
      />

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full data-table">
            <thead>
              <tr className="border-b border-slate-100">
                {['Name', 'Email', 'Role', 'Status', 'Created', ''].map((h, i) => (
                  <th key={i} className={cn('px-4 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wider text-left', h === 'Status' && 'text-center', h === '' && 'w-20')}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {loading ? Array.from({ length: 3 }).map((_, i) => (
                <tr key={i}>{Array.from({ length: 6 }).map((_, j) => <td key={j} className="px-4 py-3"><div className="skeleton h-4 rounded" /></td>)}</tr>
              )) : users.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-slate-400 text-sm">No users found.</td></tr>
              ) : users.map(u => (
                <tr key={u.id} className="hover:bg-slate-50/60 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-400 to-violet-500 flex items-center justify-center flex-shrink-0">
                        <span className="text-white text-xs font-bold">{(u.name || u.email)[0].toUpperCase()}</span>
                      </div>
                      <span className="font-semibold text-slate-800 text-sm">{u.name || '—'}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600">{u.email}</td>
                  <td className="px-4 py-3"><span className={cn('badge', roleColors[u.role] || roleColors.VIEWER)}>{u.role}</span></td>
                  <td className="px-4 py-3 text-center"><Badge status={u.isActive ? 'ACTIVE' : 'INACTIVE'} /></td>
                  <td className="px-4 py-3 text-xs text-slate-400">{formatDate(u.createdAt)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button onClick={() => openEdit(u)} className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"><Edit2 size={13} /></button>
                      {u.isActive && <button onClick={() => handleDeactivate(u.id)} className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"><UserX size={13} /></button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)}
        title={editing ? 'Edit User' : 'Invite User'} size="sm"
        footer={<><Button variant="outline" onClick={() => setShowModal(false)}>Cancel</Button><Button onClick={handleSave} loading={saving}>{editing ? 'Update' : 'Invite'}</Button></>}
      >
        <div className="space-y-4">
          <Input label="Full Name" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          <Input label="Email" type="email" required value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} disabled={!!editing} />
          {!editing && <Input label="Password" type="password" required value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />}
          <Select label="Role" value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
            {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
          </Select>
          <div className="text-xs text-slate-500 bg-slate-50 rounded-lg p-3 space-y-1">
            <p><strong>ADMIN</strong> — Full access, manage users</p>
            <p><strong>ACCOUNTANT</strong> — Create & edit all financial records</p>
            <p><strong>VIEWER</strong> — Read-only access to reports</p>
          </div>
        </div>
      </Modal>
    </div>
  )
}
