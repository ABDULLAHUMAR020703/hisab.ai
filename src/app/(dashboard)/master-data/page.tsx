'use client'

import { useEffect, useState } from 'react'
import { Database, Plus } from 'lucide-react'

const TABS = [
  { id: 'units_of_measure', label: 'Units of Measure', fields: ['code', 'name', 'description'] },
  { id: 'warehouses', label: 'Warehouses', fields: ['code', 'name', 'address'] },
  { id: 'payment_terms', label: 'Payment Terms', fields: ['name', 'days', 'description'] },
  { id: 'departments', label: 'Departments', fields: ['code', 'name', 'description'] },
  { id: 'company_currencies', label: 'Currencies', fields: ['code', 'name', 'symbol'] },
] as const

type TabId = (typeof TABS)[number]['id']

export default function MasterDataPage() {
  const [activeTab, setActiveTab] = useState<TabId>('units_of_measure')
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState<Record<string, string>>({})

  const tab = TABS.find((t) => t.id === activeTab)!

  async function load() {
    setLoading(true)
    const res = await fetch(`/api/master-data/${activeTab}`)
    if (res.ok) setRows(await res.json())
    setLoading(false)
  }

  useEffect(() => { void load() }, [activeTab])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    const payload: Record<string, unknown> = {}
    for (const field of tab.fields) {
      if (form[field]) {
        payload[field] = field === 'days' ? Number(form[field]) : form[field]
      }
    }
    const res = await fetch(`/api/master-data/${activeTab}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (res.ok) {
      setForm({})
      void load()
    }
  }

  return (
    <div className="p-6 max-w-[1200px] mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
          <Database size={22} className="text-indigo-600" /> Master Data
        </h1>
        <p className="text-slate-500 text-sm mt-0.5">Units, warehouses, payment terms, departments, and currencies</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${activeTab === t.id ? 'bg-indigo-600 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}>
            {t.label}
          </button>
        ))}
      </div>

      <form onSubmit={handleCreate} className="bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap gap-3 items-end">
        {tab.fields.map((field) => (
          <div key={field}>
            <label className="block text-xs font-medium text-slate-600 mb-1 capitalize">{field.replace('_', ' ')}</label>
            <input value={form[field] ?? ''} onChange={(e) => setForm({ ...form, [field]: e.target.value })}
              className="border border-slate-200 rounded-lg px-3 py-2 text-sm" />
          </div>
        ))}
        <button type="submit" className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium">
          <Plus size={14} /> Add
        </button>
      </form>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {loading ? (
          <p className="p-6 text-sm text-slate-400">Loading...</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                {tab.fields.map((f) => (
                  <th key={f} className="text-left px-4 py-3 font-semibold text-slate-600 capitalize">{f.replace('_', ' ')}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={String(row.id)} className="border-b hover:bg-slate-50">
                  {tab.fields.map((f) => (
                    <td key={f} className="px-4 py-2.5">{String(row[f] ?? '')}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
