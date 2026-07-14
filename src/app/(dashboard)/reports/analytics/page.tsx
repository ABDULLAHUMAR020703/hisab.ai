'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { TrendingUp, DollarSign, Wallet, PieChart } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { useFormatCurrency } from '@/hooks/use-company-currency'

interface DashboardKpis {
  revenue: number
  netProfit: number
  grossMargin: number
  totalAssets: number
  cashFlow: number
  accountsReceivable: number
  accountsPayable: number
  workingCapital: number
}

export default function AnalyticsPage() {
  const formatCurrency = useFormatCurrency()
  const [kpis, setKpis] = useState<DashboardKpis | null>(null)

  useEffect(() => {
    fetch('/api/reporting/analytics?view=dashboard')
      .then((r) => r.json())
      .then((d) => setKpis(d.kpis ?? d))
  }, [])

  const cards = kpis ? [
    { label: 'Revenue', value: formatCurrency(kpis.revenue), icon: TrendingUp, color: 'text-indigo-600' },
    { label: 'Net Profit', value: formatCurrency(kpis.netProfit), icon: DollarSign, color: kpis.netProfit >= 0 ? 'text-emerald-600' : 'text-red-600' },
    { label: 'Gross Margin', value: `${kpis.grossMargin.toFixed(1)}%`, icon: PieChart, color: 'text-violet-600' },
    { label: 'Cash Flow', value: formatCurrency(kpis.cashFlow), icon: Wallet, color: 'text-sky-600' },
    { label: 'Working Capital', value: formatCurrency(kpis.workingCapital), icon: Wallet, color: 'text-amber-600' },
    { label: 'Accounts Receivable', value: formatCurrency(kpis.accountsReceivable), icon: TrendingUp, color: 'text-rose-600' },
    { label: 'Accounts Payable', value: formatCurrency(kpis.accountsPayable), icon: TrendingUp, color: 'text-orange-600' },
    { label: 'Total Assets', value: formatCurrency(kpis.totalAssets), icon: PieChart, color: 'text-emerald-600' },
  ] : []

  return (
    <div className="p-6 max-w-[1600px] mx-auto space-y-6">
      <PageHeader
        title="Executive Analytics"
        subtitle="Financial KPIs, trends, and turnover metrics"
        breadcrumb={[{ label: 'Reports' }, { label: 'Analytics' }]}
        action={(
          <Link href="/reports/enterprise" className="inline-flex items-center h-9 px-4 text-sm rounded-lg border border-slate-200 bg-white hover:bg-slate-50">
            Enterprise Reports
          </Link>
        )}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {cards.map((c) => {
          const Icon = c.icon
          return (
            <div key={c.label} className="rounded-xl border bg-card p-5">
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                <Icon className={`w-4 h-4 ${c.color}`} />
                {c.label}
              </div>
              <div className={`text-2xl font-semibold ${c.color}`}>{c.value}</div>
            </div>
          )
        })}
      </div>

      {!kpis && (
        <div className="text-center text-muted-foreground py-12">Loading analytics…</div>
      )}
    </div>
  )
}
