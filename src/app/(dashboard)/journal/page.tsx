'use client'

import { useEffect, useState } from 'react'
import { Plus, Search, Check, AlertCircle, Upload } from 'lucide-react'
import { formatDate, formatCurrency } from '@/lib/utils'
import { CsvImportModal } from '@/components/ui/csv-import-modal'

interface Account { id: string; accountNo: string; name: string; accountType: string }
interface CostCenter { id: string; code: string; name: string }
interface JournalLine {
  accountId: string; costCenterId: string; description: string; debit: number; credit: number; taxRate: number
}
interface JournalEntry {
  id: string; entryNo: string; date: string; description: string; reference?: string
  status: string; totalDebit: number; totalCredit: number; createdBy: { name: string }
  lines: (JournalLine & { account: Account; costCenter: CostCenter | null })[]
}

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-600',
  POSTED: 'bg-green-100 text-green-700',
}

const EMPTY_LINE: JournalLine = { accountId: '', costCenterId: '', description: '', debit: 0, credit: 0, taxRate: 0 }

export default function JournalPage() {
  const [entries, setEntries] = useState<JournalEntry[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [costCenters, setCostCenters] = useState<CostCenter[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ date: new Date().toISOString().split('T')[0], description: '', reference: '', lines: [{ ...EMPTY_LINE }, { ...EMPTY_LINE }] })

  async function load() {
    setLoading(true)
    const params = new URLSearchParams()
    if (search) params.set('search', search)
    const [entRes, accRes, ccRes] = await Promise.all([
      fetch(`/api/journal?${params}`),
      fetch('/api/accounts'),
      fetch('/api/cost-centers'),
    ])
    if (entRes.ok) setEntries(await entRes.json())
    if (accRes.ok) setAccounts(await accRes.json())
    if (ccRes.ok) setCostCenters(await ccRes.json())
    setLoading(false)
  }

  useEffect(() => { load() }, [search])

  const totalDebit = form.lines.reduce((s, l) => s + (Number(l.debit) || 0), 0)
  const totalCredit = form.lines.reduce((s, l) => s + (Number(l.credit) || 0), 0)
  const balanced = Math.abs(totalDebit - totalCredit) < 0.01

  function updateLine(idx: number, field: string, value: string | number) {
    setForm((f) => ({ ...f, lines: f.lines.map((l, i) => i === idx ? { ...l, [field]: value } : l) }))
  }

  function addLine() {
    setForm((f) => ({ ...f, lines: [...f.lines, { ...EMPTY_LINE }] }))
  }

  function removeLine(idx: number) {
    if (form.lines.length <= 2) return
    setForm((f) => ({ ...f, lines: f.lines.filter((_, i) => i !== idx) }))
  }

  async function handleSave() {
    setError('')
    setSaving(true)
    try {
      const res = await fetch('/api/journal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Failed to save'); return }
      setShowModal(false)
      load()
    } finally {
      setSaving(false)
    }
  }

  async function handlePost(id: string) {
    await fetch(`/api/journal/${id}/post`, { method: 'POST' })
    load()
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Journal Entries</h1>
          <p className="text-gray-500 text-sm mt-0.5">{entries.length} entries</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowImport(true)} className="flex items-center gap-2 px-4 py-2 border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 rounded-lg text-sm font-medium transition-colors">
            <Upload size={15} /> Import CSV
          </button>
          <button onClick={() => { setShowModal(true); setError('') }} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition-colors">
            <Plus size={16} /> New Entry
          </button>
        </div>
      </div>

      <div className="flex gap-3 mb-4">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search entries..."
            className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-xs text-gray-500 uppercase">
                <th className="px-4 py-3 text-left font-medium">Entry No.</th>
                <th className="px-4 py-3 text-left font-medium">Date</th>
                <th className="px-4 py-3 text-left font-medium">Description</th>
                <th className="px-4 py-3 text-right font-medium">Debit</th>
                <th className="px-4 py-3 text-right font-medium">Credit</th>
                <th className="px-4 py-3 text-center font-medium">Status</th>
                <th className="px-4 py-3 text-center font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">Loading...</td></tr>
              ) : entries.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">No journal entries yet</td></tr>
              ) : entries.map((e) => (
                <tr key={e.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-medium text-indigo-600">{e.entryNo}</td>
                  <td className="px-4 py-2.5 text-gray-600">{formatDate(e.date)}</td>
                  <td className="px-4 py-2.5 text-gray-800">{e.description}</td>
                  <td className="px-4 py-2.5 text-right font-mono">{formatCurrency(e.totalDebit)}</td>
                  <td className="px-4 py-2.5 text-right font-mono">{formatCurrency(e.totalCredit)}</td>
                  <td className="px-4 py-2.5 text-center">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[e.status] ?? 'bg-gray-100 text-gray-600'}`}>{e.status}</span>
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    {e.status === 'DRAFT' && (
                      <button onClick={() => handlePost(e.id)} className="flex items-center gap-1 mx-auto text-xs text-green-600 hover:text-green-800 font-medium">
                        <Check size={12} /> Post
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <CsvImportModal type="journal" open={showImport} onClose={() => setShowImport(false)} onSuccess={load} />

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">New Journal Entry</h2>

            {error && (
              <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm flex items-center gap-2">
                <AlertCircle size={16} /> {error}
              </div>
            )}

            <div className="grid grid-cols-3 gap-3 mb-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Date *</label>
                <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Description *</label>
                <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Reference</label>
                <input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
            </div>

            {/* Lines */}
            <div className="border border-gray-200 rounded-lg overflow-hidden mb-3">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 text-gray-500 uppercase">
                    <th className="px-3 py-2 text-left font-medium">Account</th>
                    <th className="px-3 py-2 text-left font-medium">Cost Center</th>
                    <th className="px-3 py-2 text-left font-medium">Description</th>
                    <th className="px-3 py-2 text-right font-medium w-28">Debit</th>
                    <th className="px-3 py-2 text-right font-medium w-28">Credit</th>
                    <th className="px-3 py-2 w-8"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {form.lines.map((line, idx) => (
                    <tr key={idx}>
                      <td className="px-2 py-1.5">
                        <select value={line.accountId} onChange={(e) => updateLine(idx, 'accountId', e.target.value)}
                          className="w-full border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500">
                          <option value="">Select account...</option>
                          {accounts.filter(a => a.accountType !== 'Header').map((a) => (
                            <option key={a.id} value={a.id}>{a.accountNo} - {a.name}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-1.5">
                        <select value={line.costCenterId} onChange={(e) => updateLine(idx, 'costCenterId', e.target.value)}
                          className="w-full border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500">
                          <option value="">—</option>
                          {costCenters.map((cc) => <option key={cc.id} value={cc.id}>{cc.code}</option>)}
                        </select>
                      </td>
                      <td className="px-2 py-1.5">
                        <input value={line.description} onChange={(e) => updateLine(idx, 'description', e.target.value)}
                          className="w-full border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                      </td>
                      <td className="px-2 py-1.5">
                        <input type="number" min="0" step="0.01" value={line.debit || ''}
                          onChange={(e) => updateLine(idx, 'debit', parseFloat(e.target.value) || 0)}
                          className="w-full border border-gray-300 rounded px-2 py-1 text-xs text-right focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                      </td>
                      <td className="px-2 py-1.5">
                        <input type="number" min="0" step="0.01" value={line.credit || ''}
                          onChange={(e) => updateLine(idx, 'credit', parseFloat(e.target.value) || 0)}
                          className="w-full border border-gray-300 rounded px-2 py-1 text-xs text-right focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <button onClick={() => removeLine(idx)} className="text-red-400 hover:text-red-600 text-lg leading-none">×</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-50 font-semibold text-xs">
                    <td colSpan={3} className="px-3 py-2 text-gray-600">Total</td>
                    <td className={`px-3 py-2 text-right font-mono ${balanced ? 'text-green-600' : 'text-red-600'}`}>
                      {totalDebit.toFixed(2)}
                    </td>
                    <td className={`px-3 py-2 text-right font-mono ${balanced ? 'text-green-600' : 'text-red-600'}`}>
                      {totalCredit.toFixed(2)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="flex items-center justify-between">
              <button onClick={addLine} className="text-sm text-indigo-600 hover:text-indigo-800 font-medium flex items-center gap-1">
                <Plus size={14} /> Add Line
              </button>
              {!balanced && totalDebit > 0 && (
                <span className="text-xs text-red-600 flex items-center gap-1">
                  <AlertCircle size={12} /> Difference: {Math.abs(totalDebit - totalCredit).toFixed(2)}
                </span>
              )}
            </div>

            <div className="flex gap-3 mt-4">
              <button onClick={() => setShowModal(false)} className="flex-1 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
              <button onClick={handleSave} disabled={saving || !balanced} className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium">
                {saving ? 'Saving...' : 'Save Entry'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
