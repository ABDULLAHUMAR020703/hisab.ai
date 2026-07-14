'use client'

import { useState } from 'react'
import { useFormatCurrency } from '@/hooks/use-company-currency'
import { formatDate } from '@/lib/utils'

interface AgedReport {
  asOf: string
  buckets: Record<string, { total: number; count: number }>
  grandTotal: number
  details: Array<{
    id: string; invoiceNo: string; customer?: { name: string }
    dueDate: string; balance: number; daysPastDue: number; bucket: string
  }>
}

export default function AgedArPage() {
  const formatCurrency = useFormatCurrency()
  const [asOf, setAsOf] = useState(new Date().toISOString().split('T')[0])
  const [data, setData] = useState<AgedReport | null>(null)
  const [loading, setLoading] = useState(false)

  async function load() {
    setLoading(true)
    const res = await fetch(`/api/reports/aged-ar?asOf=${asOf}`)
    if (res.ok) setData(await res.json())
    setLoading(false)
  }

  return (
    <div className="p-6 max-w-[1600px] mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Aged Accounts Receivable</h1>
        <p className="text-slate-500 text-sm mt-0.5">Outstanding customer invoices by aging bucket</p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">As of</label>
          <input type="date" value={asOf} onChange={e => setAsOf(e.target.value)} className="input-base" />
        </div>
        <button onClick={load} disabled={loading} className="btn-primary px-4 py-2 rounded-xl text-sm font-semibold">
          {loading ? 'Loading...' : 'Generate'}
        </button>
      </div>

      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {Object.entries(data.buckets).map(([bucket, agg]) => (
              <div key={bucket} className="bg-white rounded-xl border border-slate-200 p-4">
                <p className="text-xs text-slate-500 uppercase">{bucket}</p>
                <p className="text-lg font-bold text-slate-900 tabular">{formatCurrency(agg.total)}</p>
                <p className="text-xs text-slate-400">{agg.count} invoices</p>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex justify-between">
              <span className="font-semibold text-slate-800">Detail</span>
              <span className="font-bold text-indigo-600 tabular">{formatCurrency(data.grandTotal)}</span>
            </div>
            <table className="w-full data-table">
              <thead>
                <tr className="border-b border-slate-100">
                  {['Invoice', 'Customer', 'Due', 'Days', 'Bucket', 'Balance'].map(h => (
                    <th key={h} className="px-4 py-2 text-left text-[11px] font-semibold text-slate-400 uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {data.details.map(row => (
                  <tr key={row.id}>
                    <td className="px-4 py-2 text-xs font-mono text-indigo-600">{row.invoiceNo}</td>
                    <td className="px-4 py-2 text-sm">{row.customer?.name ?? '—'}</td>
                    <td className="px-4 py-2 text-xs">{formatDate(row.dueDate)}</td>
                    <td className="px-4 py-2 text-xs tabular">{row.daysPastDue}</td>
                    <td className="px-4 py-2 text-xs">{row.bucket}</td>
                    <td className="px-4 py-2 text-sm font-semibold text-right tabular">{formatCurrency(row.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
