'use client'

import { useEffect, useState } from 'react'
import { Plus, RefreshCw, Edit2 } from 'lucide-react'
import { formatCurrency, cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { Input, Select } from '@/components/ui/input'
import { PageHeader, SearchBar, FilterBar } from '@/components/ui/page-header'
import { readApiError } from '@/lib/api-client'

interface Employee {
  id: string; employeeNo: string; name: string; email?: string; phone?: string
  department?: string; position?: string; salary: number; salaryType: string
  joiningDate: string; isActive: boolean
}

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<Employee | null>(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    name: '', email: '', phone: '', department: '', position: '',
    joiningDate: new Date().toISOString().split('T')[0], salary: 0, salaryType: 'MONTHLY', bankAccount: ''
  })

  async function load() {
    setLoading(true)
    const params = new URLSearchParams()
    if (search) params.set('search', search)
    const res = await fetch(`/api/employees?${params}`)
    if (res.ok) setEmployees(await res.json())
    setLoading(false)
  }

  useEffect(() => { load() }, [search])

  function openCreate() {
    setEditing(null)
    setForm({ name: '', email: '', phone: '', department: '', position: '', joiningDate: new Date().toISOString().split('T')[0], salary: 0, salaryType: 'MONTHLY', bankAccount: '' })
    setShowModal(true)
  }

  function openEdit(e: Employee) {
    setEditing(e)
    setForm({ name: e.name, email: e.email || '', phone: e.phone || '', department: e.department || '', position: e.position || '', joiningDate: e.joiningDate.split('T')[0], salary: e.salary, salaryType: e.salaryType, bankAccount: '' })
    setShowModal(true)
  }

  async function handleSave() {
    setSaving(true)
    const url = editing ? `/api/employees/${editing.id}` : '/api/employees'
    const res = await fetch(url, { method: editing ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
    if (!res.ok) {
      alert(await readApiError(res))
      setSaving(false)
      return
    }
    if (res.ok) { setShowModal(false); load() }
    setSaving(false)
  }

  const active = employees.filter(e => e.isActive).length
  const totalPayroll = employees.filter(e => e.isActive).reduce((s, e) => s + e.salary, 0)

  return (
    <div className="p-6 max-w-[1600px] mx-auto space-y-5">
      <PageHeader
        title="Employees"
        subtitle={`${active} active · ${formatCurrency(totalPayroll)}/month payroll`}
        breadcrumb={[{ label: 'Operations' }, { label: 'Employees' }]}
        action={<Button onClick={openCreate}><Plus size={15} /> New Employee</Button>}
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Employees', value: employees.length, color: 'text-slate-700' },
          { label: 'Active', value: active, color: 'text-emerald-600' },
          { label: 'Inactive', value: employees.length - active, color: 'text-slate-400' },
          { label: 'Monthly Payroll', value: formatCurrency(totalPayroll), color: 'text-indigo-600' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-slate-200 px-4 py-3">
            <p className="text-xs text-slate-400 font-medium">{s.label}</p>
            <p className={cn('text-lg font-bold mt-0.5', s.color)}>{s.value}</p>
          </div>
        ))}
      </div>

      <FilterBar>
        <SearchBar value={search} onChange={setSearch} placeholder="Search employees..." className="flex-1 max-w-sm" />
        <button onClick={load} className="p-2 border border-slate-200 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-50 bg-white transition-colors">
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
        </button>
      </FilterBar>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full data-table">
            <thead>
              <tr className="border-b border-slate-100">
                {['#', 'Name', 'Department', 'Position', 'Joined', 'Salary', 'Type', 'Status', ''].map((h, i) => (
                  <th key={i} className={cn('px-4 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wider text-left', h === 'Salary' && 'text-right', h === 'Status' && 'text-center', h === '' && 'w-16')}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {loading ? Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>{Array.from({ length: 9 }).map((_, j) => <td key={j} className="px-4 py-3"><div className="skeleton h-4 rounded" /></td>)}</tr>
              )) : employees.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-16 text-center text-slate-400 text-sm">No employees yet.</td></tr>
              ) : employees.map(e => (
                <tr key={e.id} className="hover:bg-slate-50/60 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{e.employeeNo}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-400 to-violet-500 flex items-center justify-center flex-shrink-0">
                        <span className="text-white text-xs font-bold">{e.name[0]}</span>
                      </div>
                      <div>
                        <p className="font-semibold text-slate-800 text-sm">{e.name}</p>
                        {e.email && <p className="text-xs text-slate-400">{e.email}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600">{e.department || '—'}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{e.position || '—'}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{new Date(e.joiningDate).toLocaleDateString('en-GB')}</td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-800 tabular">{formatCurrency(e.salary)}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{e.salaryType}</td>
                  <td className="px-4 py-3 text-center"><Badge status={e.isActive ? 'ACTIVE' : 'INACTIVE'} /></td>
                  <td className="px-4 py-3">
                    <button onClick={() => openEdit(e)} className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"><Edit2 size={13} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)}
        title={editing ? 'Edit Employee' : 'New Employee'} size="md"
        footer={<><Button variant="outline" onClick={() => setShowModal(false)}>Cancel</Button><Button onClick={handleSave} loading={saving}>Save Employee</Button></>}
      >
        <div className="space-y-4">
          <Input label="Full Name" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          <div className="grid grid-cols-2 gap-4">
            <Input label="Email" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
            <Input label="Phone" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label="Department" value={form.department} onChange={e => setForm({ ...form, department: e.target.value })} />
            <Input label="Position" value={form.position} onChange={e => setForm({ ...form, position: e.target.value })} />
          </div>
          <Input label="Joining Date" type="date" required value={form.joiningDate} onChange={e => setForm({ ...form, joiningDate: e.target.value })} />
          <div className="grid grid-cols-2 gap-4">
            <Input label="Salary (SAR)" type="number" required value={form.salary} onChange={e => setForm({ ...form, salary: parseFloat(e.target.value) || 0 })} />
            <Select label="Salary Type" value={form.salaryType} onChange={e => setForm({ ...form, salaryType: e.target.value })}>
              <option value="MONTHLY">Monthly</option>
              <option value="HOURLY">Hourly</option>
            </Select>
          </div>
          <Input label="Bank Account" value={form.bankAccount} onChange={e => setForm({ ...form, bankAccount: e.target.value })} placeholder="IBAN / Account number" />
        </div>
      </Modal>
    </div>
  )
}
