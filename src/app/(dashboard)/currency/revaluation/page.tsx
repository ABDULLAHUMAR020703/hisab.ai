'use client'

import { useEffect, useState } from 'react'
import { RefreshCw, Play, ArrowRightLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import { useFormatCurrency } from '@/hooks/use-company-currency'
import { readApiError } from '@/lib/api-client'

interface RevaluationLine {
  accountNo: string
  accountName: string
  currency: string
  transactionBalance: number
  priorRate: number
  newRate: number
  adjustmentAmount: number
}

interface RevaluationPreview {
  revaluationDate: string
  baseCurrency: string
  reportingCurrency: string
  lines: RevaluationLine[]
  totalGain: number
  totalLoss: number
  netAdjustment: number
}

export default function CurrencyRevaluationPage() {
  const formatCurrency = useFormatCurrency()
  const [asOf, setAsOf] = useState(new Date().toISOString().substring(0, 10))
  const [preview, setPreview] = useState<RevaluationPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [running, setRunning] = useState(false)
  const [notes, setNotes] = useState('Period-end currency revaluation')

  async function loadPreview() {
    setLoading(true)
    const res = await fetch(`/api/currency/revaluation?asOf=${encodeURIComponent(asOf)}`)
    if (res.ok) setPreview(await res.json())
    else alert(await readApiError(res))
    setLoading(false)
  }

  useEffect(() => { loadPreview() }, [])

  async function runRevaluation() {
    if (!confirm('Post unrealized FX adjustments to the ledger?')) return
    setRunning(true)
    const res = await fetch('/api/currency/revaluation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ asOf, notes }),
    })
    if (!res.ok) {
      alert(await readApiError(res))
    } else {
      alert('Currency revaluation posted successfully')
      loadPreview()
    }
    setRunning(false)
  }

  return (
    <div className="p-6 max-w-[1600px] mx-auto space-y-6">
      <PageHeader
        title="Currency Revaluation Wizard"
        subtitle="Revalue foreign currency AR/AP and bank balances; post unrealized FX gain/loss"
        breadcrumb={[{ label: 'Accounting' }, { label: 'Currency Revaluation' }]}
        action={(
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={loadPreview} disabled={loading}>
              <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              Preview
            </Button>
            <Button onClick={runRevaluation} disabled={running || !preview?.lines.length}>
              <Play className="w-4 h-4 mr-2" />
              Run Revaluation
            </Button>
          </div>
        )}
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-xl border bg-card p-4 space-y-3">
          <label className="text-sm font-medium">Revaluation date</label>
          <Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
          <label className="text-sm font-medium">Notes</label>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <div className="rounded-xl border bg-card p-4">
          <div className="text-sm text-muted-foreground">Base currency</div>
          <div className="text-2xl font-semibold">{preview?.baseCurrency ?? '—'}</div>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <div className="text-sm text-muted-foreground">Reporting currency</div>
          <div className="text-2xl font-semibold">{preview?.reportingCurrency ?? '—'}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-xl border bg-card p-4">
          <div className="text-sm text-muted-foreground">Unrealized gain</div>
          <div className="text-xl font-semibold text-emerald-600">
            {formatCurrency(preview?.totalGain ?? 0)}
          </div>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <div className="text-sm text-muted-foreground">Unrealized loss</div>
          <div className="text-xl font-semibold text-red-600">
            {formatCurrency(preview?.totalLoss ?? 0)}
          </div>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <div className="text-sm text-muted-foreground">Net adjustment</div>
          <div className="text-xl font-semibold">
            {formatCurrency(preview?.netAdjustment ?? 0)}
          </div>
        </div>
      </div>

      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b flex items-center gap-2 font-medium">
          <ArrowRightLeft className="w-4 h-4" />
          Revaluation preview ({preview?.lines.length ?? 0} accounts)
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left p-3">Account</th>
                <th className="text-left p-3">Currency</th>
                <th className="text-right p-3">Balance</th>
                <th className="text-right p-3">Prior rate</th>
                <th className="text-right p-3">New rate</th>
                <th className="text-right p-3">Adjustment</th>
              </tr>
            </thead>
            <tbody>
              {(preview?.lines ?? []).map((line) => (
                <tr key={`${line.accountNo}-${line.currency}`} className="border-t">
                  <td className="p-3">{line.accountNo} — {line.accountName}</td>
                  <td className="p-3">{line.currency}</td>
                  <td className="p-3 text-right">{line.transactionBalance.toFixed(2)}</td>
                  <td className="p-3 text-right">{line.priorRate.toFixed(6)}</td>
                  <td className="p-3 text-right">{line.newRate.toFixed(6)}</td>
                  <td className={`p-3 text-right font-medium ${line.adjustmentAmount >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {formatCurrency(line.adjustmentAmount)}
                  </td>
                </tr>
              ))}
              {!preview?.lines.length && (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-muted-foreground">
                    No foreign currency balances require revaluation for this date.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
