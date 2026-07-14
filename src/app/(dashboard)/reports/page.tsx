'use client'

import Link from 'next/link'
import { BarChart3, TrendingUp, Scale, Activity, BookOpen, ArrowRight, ListChecks, LayoutGrid, Wand2 } from 'lucide-react'

const REPORTS = [
  {
    title: 'Trial Balance',
    description: 'Debit and credit totals for all accounts — verify books balance',
    href: '/reports/trial-balance',
    icon: ListChecks,
    color: 'from-amber-500 to-amber-600',
    bg: 'bg-amber-50',
    iconColor: 'text-amber-600',
  },
  {
    title: 'Profit & Loss',
    description: 'Income vs expenses, net profit or loss for any period',
    href: '/reports/profit-loss',
    icon: TrendingUp,
    color: 'from-indigo-500 to-indigo-600',
    bg: 'bg-indigo-50',
    iconColor: 'text-indigo-600',
  },
  {
    title: 'Balance Sheet',
    description: 'Assets, liabilities, and equity at a point in time',
    href: '/reports/balance-sheet',
    icon: Scale,
    color: 'from-emerald-500 to-emerald-600',
    bg: 'bg-emerald-50',
    iconColor: 'text-emerald-600',
  },
  {
    title: 'General Ledger',
    description: 'All transactions for any account over a date range',
    href: '/reports/general-ledger',
    icon: BookOpen,
    color: 'from-violet-500 to-violet-600',
    bg: 'bg-violet-50',
    iconColor: 'text-violet-600',
  },
  {
    title: 'Cash Flow',
    description: 'Cash receipts and payments, operating / investing / financing',
    href: '/reports/cash-flow',
    icon: Activity,
    color: 'from-sky-500 to-sky-600',
    bg: 'bg-sky-50',
    iconColor: 'text-sky-600',
  },
  {
    title: 'Aged AR',
    description: 'Outstanding receivables by aging bucket',
    href: '/reports/aged-ar',
    icon: BarChart3,
    color: 'from-rose-500 to-rose-600',
    bg: 'bg-rose-50',
    iconColor: 'text-rose-600',
  },
  {
    title: 'Aged AP',
    description: 'Outstanding payables by aging bucket',
    href: '/reports/aged-ap',
    icon: BarChart3,
    color: 'from-orange-500 to-orange-600',
    bg: 'bg-orange-50',
    iconColor: 'text-orange-600',
  },
]

const ENTERPRISE = [
  {
    title: 'Enterprise Reports',
    description: '40+ financial, operational, and analytics reports with export',
    href: '/reports/enterprise',
    icon: LayoutGrid,
    color: 'from-violet-500 to-purple-600',
    bg: 'bg-violet-50',
    iconColor: 'text-violet-600',
  },
  {
    title: 'Executive Analytics',
    description: 'KPIs, trends, turnover ratios, and working capital',
    href: '/reports/analytics',
    icon: BarChart3,
    color: 'from-cyan-500 to-cyan-600',
    bg: 'bg-cyan-50',
    iconColor: 'text-cyan-600',
  },
  {
    title: 'Report Builder',
    description: 'Custom reports with grouping, formulas, and saved layouts',
    href: '/reports/builder',
    icon: Wand2,
    color: 'from-fuchsia-500 to-fuchsia-600',
    bg: 'bg-fuchsia-50',
    iconColor: 'text-fuchsia-600',
  },
]

export default function ReportsPage() {
  return (
    <div className="p-6 max-w-[1600px] mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Financial Reports</h1>
        <p className="text-slate-500 text-sm mt-0.5">Generate detailed reports for any period</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {REPORTS.map(r => {
          const Icon = r.icon
          return (
            <Link key={r.href} href={r.href}
              className="group bg-white rounded-2xl border border-slate-200 shadow-sm p-6 hover:shadow-md hover:border-indigo-200 transition-all duration-200"
            >
              <div className={`w-12 h-12 rounded-2xl ${r.bg} flex items-center justify-center mb-4`}>
                <Icon size={22} className={r.iconColor} />
              </div>
              <h3 className="font-semibold text-slate-900 mb-1.5 group-hover:text-indigo-600 transition-colors">{r.title}</h3>
              <p className="text-sm text-slate-500 leading-relaxed mb-4">{r.description}</p>
              <div className="flex items-center text-xs font-semibold text-indigo-600 group-hover:gap-2 gap-1 transition-all">
                Generate Report <ArrowRight size={13} />
              </div>
            </Link>
          )
        })}
      </div>

      <div>
        <h2 className="text-lg font-semibold text-slate-900 mb-3">Enterprise Reporting</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {ENTERPRISE.map(r => {
            const Icon = r.icon
            return (
              <Link key={r.href} href={r.href}
                className="group bg-white rounded-2xl border border-slate-200 shadow-sm p-6 hover:shadow-md hover:border-violet-200 transition-all duration-200"
              >
                <div className={`w-12 h-12 rounded-2xl ${r.bg} flex items-center justify-center mb-4`}>
                  <Icon size={22} className={r.iconColor} />
                </div>
                <h3 className="font-semibold text-slate-900 mb-1.5 group-hover:text-violet-600 transition-colors">{r.title}</h3>
                <p className="text-sm text-slate-500 leading-relaxed mb-4">{r.description}</p>
                <div className="flex items-center text-xs font-semibold text-violet-600 group-hover:gap-2 gap-1 transition-all">
                  Open <ArrowRight size={13} />
                </div>
              </Link>
            )
          })}
        </div>
      </div>

      <div className="bg-gradient-to-br from-indigo-50 to-violet-50 rounded-2xl border border-indigo-100 p-6">
        <div className="flex items-center gap-3 mb-3">
          <BarChart3 size={20} className="text-indigo-600" />
          <h3 className="font-semibold text-slate-900">Quick Tips</h3>
        </div>
        <div className="grid sm:grid-cols-2 gap-4 text-sm text-slate-600">
          <div className="space-y-2">
            <p className="flex items-start gap-2"><span className="text-indigo-500 font-bold mt-0.5">→</span>Profit & Loss shows performance over a time period</p>
            <p className="flex items-start gap-2"><span className="text-indigo-500 font-bold mt-0.5">→</span>Balance Sheet is a snapshot of financial position</p>
          </div>
          <div className="space-y-2">
            <p className="flex items-start gap-2"><span className="text-indigo-500 font-bold mt-0.5">→</span>General Ledger shows all activity for a specific account</p>
            <p className="flex items-start gap-2"><span className="text-indigo-500 font-bold mt-0.5">→</span>Cash Flow tracks actual money movements</p>
          </div>
        </div>
      </div>
    </div>
  )
}
