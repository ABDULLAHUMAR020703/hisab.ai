'use client'

import { useEffect, useState } from 'react'
import { Shield, Plus, RefreshCw } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { Input, Select } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import { readApiError } from '@/lib/api-client'

interface TaxRate { id: string; name: string; rate: number; type: string; isDefault: boolean; isActive: boolean }
interface TaxReport { vatCollected: number; vatPaid: number; netVat: number; period: string }

export default function TaxPage() {
  const [taxRates, setTaxRates] = useState<TaxRate[]>([])
  const [report, setReport] = useState<TaxReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ name: '', rate: 15, type: 'VAT', isDefault: false })

  async function load() {
    setLoading(true)
    const [ratesRes, reportRes] = await Promise.all([
      fetch('/api/tax'),
      fetch('/api/tax/report'),
    ])
    if (ratesRes.ok) setTaxRates(await ratesRes.json())
    if (reportRes.ok) setReport(await reportRes.json())
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function handleSave() {
    setSaving(true)
    const res = await fetch('/api/tax', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
    if (!res.ok) {
      alert(await readApiError(res))
      setSaving(false)
      return
    }
    if (res.ok) { setShowModal(false); load() }
    setSaving(false)
  }

  return (
    <div className="p-6 max-w-[1600px] mx-auto space-y-6">
      <PageHeader
        title="Tax & ZATCA"
        subtitle="Tax rates, VAT reporting, Saudi tax authority compliance"
        breadcrumb={[{ label: 'Reports & Tax' }, { label: 'Tax & ZATCA' }]}
        action={<Button onClick={() => setShowModal(true)}><Plus size={15} /> Add Tax Rate</Button>}
      />

      {/* VAT Summary */}
      {report && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">VAT Collected (Output)</p>
            <p className="text-2xl font-bold text-emerald-600 tabular">{formatCurrency(report.vatCollected)}</p>
            <p className="text-xs text-slate-400 mt-1">From sales invoices</p>
          </div>
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">VAT Paid (Input)</p>
            <p className="text-2xl font-bold text-rose-600 tabular">{formatCurrency(report.vatPaid)}</p>
            <p className="text-xs text-slate-400 mt-1">From purchase bills</p>
          </div>
          <div className={`rounded-2xl border shadow-sm p-5 ${report.netVat >= 0 ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-200'}`}>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Net VAT {report.netVat >= 0 ? 'Payable' : 'Refundable'}</p>
            <p className={`text-2xl font-bold tabular ${report.netVat >= 0 ? 'text-amber-700' : 'text-emerald-700'}`}>{formatCurrency(Math.abs(report.netVat))}</p>
            <p className="text-xs text-slate-500 mt-1">{report.netVat >= 0 ? 'Amount due to ZATCA' : 'Refund from ZATCA'}</p>
          </div>
        </div>
      )}

      {/* ZATCA Info */}
      <div className="bg-gradient-to-br from-indigo-900 to-violet-900 rounded-2xl p-6 text-white">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center">
            <Shield size={20} />
          </div>
          <div>
            <h3 className="font-semibold">ZATCA Integration</h3>
            <p className="text-indigo-200 text-xs">Saudi Zakat, Tax and Customs Authority</p>
          </div>
        </div>
        <div className="grid sm:grid-cols-3 gap-4">
          {[
            { label: 'Standard VAT Rate', value: '15%', note: 'Saudi Arabia VAT' },
            { label: 'E-invoicing', value: 'Phase 2', note: 'Fatoorah compliant' },
            { label: 'Reporting', value: 'Quarterly', note: 'VAT return filing' },
          ].map(item => (
            <div key={item.label} className="bg-white/10 rounded-xl p-4">
              <p className="text-xs text-indigo-200">{item.label}</p>
              <p className="text-lg font-bold mt-1">{item.value}</p>
              <p className="text-xs text-indigo-300 mt-0.5">{item.note}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Tax Rates */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Tax Rates</h2>
          <button onClick={load} className="p-1.5 text-slate-400 hover:text-slate-600 transition-colors">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full data-table">
            <thead>
              <tr className="border-b border-slate-100">
                {['Name', 'Type', 'Rate', 'Default', 'Status'].map((h, i) => (
                  <th key={i} className="px-4 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wider text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {loading ? Array.from({ length: 3 }).map((_, i) => (
                <tr key={i}>{Array.from({ length: 5 }).map((_, j) => <td key={j} className="px-4 py-3"><div className="skeleton h-4 rounded" /></td>)}</tr>
              )) : taxRates.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400 text-sm">No tax rates. Add tax rates above.</td></tr>
              ) : taxRates.map(t => (
                <tr key={t.id} className="hover:bg-slate-50/60">
                  <td className="px-4 py-3 font-semibold text-slate-800">{t.name}</td>
                  <td className="px-4 py-3"><span className="badge bg-indigo-50 text-indigo-700 border border-indigo-200">{t.type}</span></td>
                  <td className="px-4 py-3 font-bold text-slate-900 tabular">{t.rate}%</td>
                  <td className="px-4 py-3">{t.isDefault && <span className="badge bg-emerald-50 text-emerald-700 border border-emerald-200">Default</span>}</td>
                  <td className="px-4 py-3"><span className={`badge ${t.isActive ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-gray-50 text-gray-500 border-gray-200'}`}>{t.isActive ? 'Active' : 'Inactive'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)}
        title="New Tax Rate" size="sm"
        footer={<><Button variant="outline" onClick={() => setShowModal(false)}>Cancel</Button><Button onClick={handleSave} loading={saving}>Save</Button></>}
      >
        <div className="space-y-4">
          <Input label="Rate Name" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="VAT 15%" />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Rate (%)" type="number" min="0" max="100" required value={form.rate} onChange={e => setForm({ ...form, rate: parseFloat(e.target.value) || 0 })} />
            <Select label="Type" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
              <option value="VAT">VAT</option>
              <option value="WITHHOLDING">Withholding</option>
              <option value="ZATCA">ZATCA</option>
            </Select>
          </div>
          <label className="flex items-center gap-2.5 cursor-pointer">
            <input type="checkbox" checked={form.isDefault} onChange={e => setForm({ ...form, isDefault: e.target.checked })} className="w-4 h-4 rounded border-slate-300 text-indigo-600" />
            <span className="text-sm text-slate-600">Set as default tax rate</span>
          </label>
        </div>
      </Modal>
    </div>
  )
}
