'use client'

import { useEffect, useState } from 'react'
import { formatDate } from '@/lib/utils'
import { useFormatCurrency } from '@/hooks/use-company-currency'

interface Account { id: string; accountNo: string; name: string }
interface LedgerEntry {
  date: string; entryNo: string; description: string; debit: number; credit: number
  balance: number; status: string; account: { accountNo: string; name: string }
  costCenter: { name: string } | null
}
interface LedgerData {
  period: { from: string; to: string }
  entries: LedgerEntry[]
  totals: { debit: number; credit: number; balance: number }
}

export default function GeneralLedgerPage() {
  const formatCurrency = useFormatCurrency()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [accountId, setAccountId] = useState('')
  const [from, setFrom] = useState(new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0])
  const [to, setTo] = useState(new Date().toISOString().split('T')[0])
  const [data, setData] = useState<LedgerData | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetch('/api/accounts').then((r) => r.json()).then((d) => setAccounts(d))
  }, [])

  async function load() {
    setLoading(true)
    const params = new URLSearchParams({ from, to })
    if (accountId) params.set('accountId', accountId)
    const res = await fetch(`/api/reports/general-ledger?${params}`)
    if (res.ok) setData(await res.json())
    setLoading(false)
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">General Ledger</h1>
        <p className="text-gray-500 text-sm mt-0.5">Transaction history by account</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Account</label>
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 min-w-[220px]">
              <option value="">All Accounts</option>
              {accounts.filter(a => a.accountNo.length >= 4).map((a) => (
                <option key={a.id} value={a.id}>{a.accountNo} - {a.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">From</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">To</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <button onClick={load} disabled={loading}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium">
            {loading ? 'Loading...' : 'View Ledger'}
          </button>
        </div>
      </div>

      {data && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b text-xs text-gray-500 uppercase">
                  <th className="px-4 py-3 text-left font-medium">Date</th>
                  <th className="px-4 py-3 text-left font-medium">Entry No.</th>
                  <th className="px-4 py-3 text-left font-medium">Description</th>
                  <th className="px-4 py-3 text-left font-medium">Account</th>
                  <th className="px-4 py-3 text-left font-medium">Cost Center</th>
                  <th className="px-4 py-3 text-right font-medium">Debit</th>
                  <th className="px-4 py-3 text-right font-medium">Credit</th>
                  <th className="px-4 py-3 text-right font-medium">Balance</th>
                  <th className="px-4 py-3 text-center font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.entries.length === 0 ? (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">No transactions found for this period</td></tr>
                ) : data.entries.map((entry, idx) => (
                  <tr key={idx} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 text-gray-600">{formatDate(entry.date)}</td>
                    <td className="px-4 py-2.5 font-medium text-indigo-600">{entry.entryNo}</td>
                    <td className="px-4 py-2.5 text-gray-700 max-w-xs truncate">{entry.description}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-500">{entry.account.accountNo} - {entry.account.name}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-500">{entry.costCenter?.name || '—'}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{entry.debit > 0 ? formatCurrency(entry.debit) : '—'}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{entry.credit > 0 ? formatCurrency(entry.credit) : '—'}</td>
                    <td className={`px-4 py-2.5 text-right font-mono font-medium ${entry.balance >= 0 ? 'text-gray-800' : 'text-red-600'}`}>
                      {formatCurrency(Math.abs(entry.balance))}{entry.balance < 0 ? ' Cr' : ''}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${entry.status === 'POSTED' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                        {entry.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-indigo-50 font-bold text-sm border-t-2 border-indigo-200">
                  <td colSpan={5} className="px-4 py-3 text-indigo-700">TOTALS</td>
                  <td className="px-4 py-3 text-right font-mono">{formatCurrency(data.totals.debit)}</td>
                  <td className="px-4 py-3 text-right font-mono">{formatCurrency(data.totals.credit)}</td>
                  <td className="px-4 py-3 text-right font-mono">{formatCurrency(Math.abs(data.totals.balance))}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {!data && !loading && (
        <div className="flex items-center justify-center h-48 text-gray-400 text-sm">
          Select filters and click &quot;View Ledger&quot;
        </div>
      )}
    </div>
  )
}
