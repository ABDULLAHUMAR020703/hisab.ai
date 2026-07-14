'use client'

import { useEffect, useState } from 'react'
import { Plus, RefreshCw } from 'lucide-react'
import { formatDate, formatCurrency as formatAmount } from '@/lib/utils'
import { useCompanyCurrency } from '@/hooks/use-company-currency'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { Input, Select } from '@/components/ui/input'
import { PageHeader, FilterBar } from '@/components/ui/page-header'
import { readApiError } from '@/lib/api-client'

interface Employee { id: string; name: string }
interface Claim {
  id: string; claim_no: string; employee_id: string; date: string
  status: string; total: number; notes?: string
}

export default function ExpenseClaimsPage() {
  const { currency: primaryCurrency } = useCompanyCurrency()
  const [claims, setClaims] = useState<Claim[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    employeeId: '', date: new Date().toISOString().split('T')[0], total: 0, notes: '',
  })

  async function load() {
    setLoading(true)
    const [cRes, eRes] = await Promise.all([fetch('/api/expense-claims'), fetch('/api/employees')])
    if (cRes.ok) setClaims(await cRes.json())
    if (eRes.ok) setEmployees(await eRes.json())
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function handleSave() {
    setSaving(true)
    const res = await fetch('/api/expense-claims', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    if (!res.ok) alert(await readApiError(res))
    else { setShowModal(false); load() }
    setSaving(false)
  }

  const employeeName = (id: string) => employees.find(e => e.id === id)?.name ?? id.slice(0, 8)

  return (
    <div className="p-6 max-w-[1600px] mx-auto space-y-5">
      <PageHeader
        title="Expense Claims"
        subtitle={`${claims.length} claims`}
        breadcrumb={[{ label: 'Expenses' }, { label: 'Claims' }]}
        action={<Button onClick={() => setShowModal(true)}><Plus size={15} /> New Claim</Button>}
      />

      <FilterBar>
        <button onClick={load} className="p-2 border border-slate-200 rounded-xl text-slate-400 hover:text-slate-600 bg-white">
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
        </button>
      </FilterBar>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full data-table">
          <thead>
            <tr className="border-b border-slate-100">
              {['Claim #', 'Employee', 'Date', 'Amount', 'Status', 'Notes'].map(h => (
                <th key={h} className="px-4 py-3 text-[11px] font-semibold text-slate-400 uppercase text-left">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">Loading...</td></tr>
            ) : claims.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-16 text-center text-slate-400">No claims yet.</td></tr>
            ) : claims.map(c => (
              <tr key={c.id} className="hover:bg-slate-50/60">
                <td className="px-4 py-3 font-mono text-xs text-indigo-600">{c.claim_no}</td>
                <td className="px-4 py-3 text-sm">{employeeName(c.employee_id)}</td>
                <td className="px-4 py-3 text-xs text-slate-500">{formatDate(c.date)}</td>
                <td className="px-4 py-3 text-sm font-semibold tabular">{formatAmount(Number(c.total), primaryCurrency)}</td>
                <td className="px-4 py-3"><Badge status={c.status} /></td>
                <td className="px-4 py-3 text-xs text-slate-500 truncate max-w-[200px]">{c.notes ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} title="New Expense Claim"
        footer={<><Button variant="outline" onClick={() => setShowModal(false)}>Cancel</Button><Button onClick={handleSave} loading={saving}>Save</Button></>}
      >
        <div className="space-y-4">
          <Select label="Employee" required value={form.employeeId} onChange={e => setForm({ ...form, employeeId: e.target.value })}>
            <option value="">Select employee</option>
            {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </Select>
          <Input label="Date" type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
          <Input label="Total" type="number" min="0" value={form.total} onChange={e => setForm({ ...form, total: parseFloat(e.target.value) || 0 })} />
          <Input label="Notes" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
        </div>
      </Modal>
    </div>
  )
}
