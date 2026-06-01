'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { formatCurrency, formatDate } from '@/lib/utils'
import { PRODUCT_NAME } from '@/lib/brand'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar,
} from 'recharts'
import {
  TrendingUp, TrendingDown, Clock, RefreshCw, FileText, Receipt,
  BookOpen, Users, Building2, DollarSign, UserCheck, Package,
  Camera, MapPin, List, CreditCard, Activity, AlertCircle,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'

interface DashboardData {
  kpis: {
    totalRevenue: number
    totalExpenses: number
    totalInvoiced: number
    totalBilled: number
    totalCollected: number
    totalPaidOut: number
    payrollTotal: number
    accountsReceivable: number
    accountsPayable: number
    openInvoices: number
    openBills: number
  }
  counts: Record<string, number>
  monthlyData: { month: string; revenue: number; expenses: number; bills: number }[]
  aging: { current: number; days30: number; days60: number; days90plus: number }
  statusBreakdown: {
    invoices: { status: string; _count: number; _sum: { total: number | null } }[]
    bills: { status: string; _count: number; _sum: { total: number | null } }[]
    journal: { status: string; _count: number }[]
    expenses: { status: string; _count: number; _sum: { total: number | null } }[]
  }
  recentInvoices: {
    id: string; invoiceNo: string; customer: { name: string }
    total: number; status: string; dueDate: string
  }[]
  recentBills: {
    id: string; billNo: string; vendor: { name: string }
    total: number; status: string; dueDate: string
  }[]
  recentExpenses: {
    id: string; expenseNo: string; description: string; category: string
    total: number; status: string; date: string
  }[]
  recentJournal: {
    id: string; entryNo: string; description: string
    status: string; totalDebit: number; date: string
    createdBy: { name: string | null }
  }[]
  recentPayroll: {
    id: string; payrollNo: string; employee: { name: string }
    netSalary: number; status: string; period: string
  }[]
  activity: {
    id: string; type: string; label: string; detail: string
    amount?: number; status?: string; date: string; href: string
  }[]
}

const AGING_COLORS = ['#22c55e', '#eab308', '#f97316', '#ef4444']

const MODULE_LINKS = [
  { key: 'invoices', label: 'Invoices', href: '/invoices', icon: FileText, color: 'text-indigo-600 bg-indigo-50' },
  { key: 'bills', label: 'Bills', href: '/bills', icon: Receipt, color: 'text-rose-600 bg-rose-50' },
  { key: 'expenses', label: 'Expenses', href: '/expenses', icon: CreditCard, color: 'text-orange-600 bg-orange-50' },
  { key: 'journalEntries', label: 'Journal', href: '/journal', icon: BookOpen, color: 'text-violet-600 bg-violet-50' },
  { key: 'customers', label: 'Customers', href: '/customers', icon: Users, color: 'text-sky-600 bg-sky-50' },
  { key: 'vendors', label: 'Vendors', href: '/vendors', icon: Building2, color: 'text-amber-600 bg-amber-50' },
  { key: 'payroll', label: 'Payroll', href: '/payroll', icon: DollarSign, color: 'text-emerald-600 bg-emerald-50' },
  { key: 'employees', label: 'Employees', href: '/employees', icon: UserCheck, color: 'text-teal-600 bg-teal-50' },
  { key: 'inventory', label: 'Inventory', href: '/inventory', icon: Package, color: 'text-fuchsia-600 bg-fuchsia-50' },
  { key: 'receipts', label: 'Receipts', href: '/receipts', icon: Camera, color: 'text-slate-600 bg-slate-100' },
  { key: 'accounts', label: 'Accounts', href: '/accounts', icon: List, color: 'text-indigo-600 bg-indigo-50' },
  { key: 'costCenters', label: 'Cost Centers', href: '/cost-centers', icon: MapPin, color: 'text-violet-600 bg-violet-50' },
]

const ACTIVITY_ICONS: Record<string, typeof FileText> = {
  invoice: FileText,
  bill: Receipt,
  expense: CreditCard,
  journal: BookOpen,
  payroll: DollarSign,
  payment: DollarSign,
  customer: Users,
  vendor: Building2,
  employee: UserCheck,
  inventory: Package,
  receipt: Camera,
}

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-xl p-3 min-w-[160px]">
      <p className="text-xs font-semibold text-slate-500 mb-2">{label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center justify-between gap-4 text-xs">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full" style={{ background: p.color }} />
            <span className="text-slate-600">{p.name}</span>
          </div>
          <span className="font-semibold text-slate-900">{formatCurrency(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

export default function DashboardPage() {
  const router = useRouter()
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [seeding, setSeeding] = useState(false)
  const [seedMsg, setSeedMsg] = useState('')

  const loadData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/dashboard')
      if (res.status === 401) {
        router.push('/login')
        return
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setError(err.error || 'Failed to load dashboard')
        setData(null)
        return
      }
      setData(await res.json())
    } catch {
      setError('Could not connect to the server')
    } finally {
      setLoading(false)
    }
  }, [router])

  async function handleSeed() {
    setSeeding(true)
    setSeedMsg('')
    try {
      const res = await fetch('/api/seed', { method: 'POST' })
      const d = await res.json()
      setSeedMsg(d.message || d.error || 'Done')
      await loadData()
    } finally {
      setSeeding(false)
    }
  }

  useEffect(() => { loadData() }, [loadData])

  const kpis = data?.kpis ?? {
    totalRevenue: 0, totalExpenses: 0, totalInvoiced: 0, totalBilled: 0,
    totalCollected: 0, totalPaidOut: 0, payrollTotal: 0,
    accountsReceivable: 0, accountsPayable: 0, openInvoices: 0, openBills: 0,
  }
  const netProfit = kpis.totalRevenue - kpis.totalExpenses
  const counts = data?.counts ?? {}

  const chartMonthly = (data?.monthlyData ?? []).map((d) => ({
    ...d,
    totalExpenses: d.expenses + d.bills,
    profit: d.revenue - d.expenses - d.bills,
  }))

  const agingData = data ? [
    { name: 'Current', value: data.aging.current },
    { name: '1–30 days', value: data.aging.days30 },
    { name: '31–60 days', value: data.aging.days60 },
    { name: '90+ days', value: data.aging.days90plus },
  ] : []

  const hasActivity = data && (
    data.activity.length > 0 ||
    Object.values(data.counts).some((n) => n > 0)
  )

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto">

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Financial Overview</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            Live summary of all activity across {PRODUCT_NAME} · {new Date().toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {seedMsg && (
            <span className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-lg font-medium">
              {seedMsg}
            </span>
          )}
          <button
            onClick={loadData}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
          <button
            onClick={handleSeed}
            disabled={seeding}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white rounded-xl disabled:opacity-50 transition-all shadow-sm"
            style={{ background: 'linear-gradient(135deg, #6366f1, #4f46e5)' }}
          >
            {seeding ? 'Loading sample data...' : 'Load sample data'}
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
          <AlertCircle size={18} />
          {error}
        </div>
      )}

      {!loading && !error && !hasActivity && (
        <div className="rounded-2xl border border-dashed border-indigo-200 bg-indigo-50/50 p-8 text-center">
          <Activity size={32} className="mx-auto text-indigo-400 mb-3" />
          <h2 className="font-semibold text-slate-900 mb-1">No transactions yet</h2>
          <p className="text-sm text-slate-500 mb-4 max-w-md mx-auto">
            Create invoices, bills, expenses, and journal entries in the app, or click &quot;Load sample data&quot; to populate the dashboard with demo records.
          </p>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard title="Revenue (subtotal)" value={formatCurrency(kpis.totalRevenue)} sub={`${counts.invoices ?? 0} invoices · ${formatCurrency(kpis.totalInvoiced)} total`} color="bg-gradient-to-br from-indigo-500 to-indigo-600" icon={<TrendingUp size={20} className="text-white" />} loading={loading} />
        <KpiCard title="Total costs" value={formatCurrency(kpis.totalExpenses)} sub={`Expenses + bills + payroll`} color="bg-gradient-to-br from-rose-500 to-rose-600" icon={<TrendingDown size={20} className="text-white" />} loading={loading} />
        <KpiCard title="Net profit" value={formatCurrency(netProfit)} sub={netProfit >= 0 ? 'Revenue minus costs' : 'Net loss'} color={netProfit >= 0 ? 'bg-gradient-to-br from-emerald-500 to-emerald-600' : 'bg-gradient-to-br from-orange-500 to-orange-600'} icon={<TrendingUp size={20} className="text-white" />} loading={loading} />
        <KpiCard title="Receivable" value={formatCurrency(kpis.accountsReceivable)} sub={`${kpis.openInvoices} open · Payable ${formatCurrency(kpis.accountsPayable)}`} color="bg-gradient-to-br from-violet-500 to-violet-600" icon={<Clock size={20} className="text-white" />} loading={loading} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
        <MiniKpi label="Collected" value={formatCurrency(kpis.totalCollected)} loading={loading} />
        <MiniKpi label="Paid out" value={formatCurrency(kpis.totalPaidOut)} loading={loading} />
        <MiniKpi label="Payroll" value={formatCurrency(kpis.payrollTotal)} loading={loading} />
        <MiniKpi label="Bills" value={String(counts.bills ?? 0)} loading={loading} />
        <MiniKpi label="Journal entries" value={String(counts.journalEntries ?? 0)} loading={loading} />
        <MiniKpi label="Payments" value={String(counts.payments ?? 0)} loading={loading} />
      </div>

      {/* Module counts */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
        <h2 className="text-sm font-semibold text-slate-900 mb-4">Everything in your books</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {MODULE_LINKS.map((mod) => {
            const Icon = mod.icon
            const count = counts[mod.key] ?? 0
            return (
              <Link
                key={mod.key}
                href={mod.href}
                className="flex items-center gap-3 p-3 rounded-xl border border-slate-100 hover:border-indigo-200 hover:shadow-sm transition-all group"
              >
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${mod.color}`}>
                  <Icon size={16} />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-slate-500 group-hover:text-indigo-600 transition-colors">{mod.label}</p>
                  <p className="text-lg font-bold text-slate-900 tabular">{loading ? '—' : count}</p>
                </div>
              </Link>
            )
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        {/* Activity feed */}
        <div className="xl:col-span-1 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden card-lift">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-900">Recent activity</h2>
            <p className="text-xs text-slate-400 mt-0.5">Latest updates across all modules</p>
          </div>
          <div className="max-h-[420px] overflow-y-auto divide-y divide-slate-50">
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="px-5 py-3 space-y-2">
                  <div className="skeleton h-3 w-3/4" />
                  <div className="skeleton h-3 w-1/2" />
                </div>
              ))
            ) : (data?.activity ?? []).length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-slate-400">No activity yet</p>
            ) : (data?.activity ?? []).map((item) => {
              const Icon = ACTIVITY_ICONS[item.type] ?? Activity
              return (
                <Link key={item.id} href={item.href} className="flex items-start gap-3 px-5 py-3 hover:bg-slate-50 transition-colors">
                  <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Icon size={14} className="text-slate-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-indigo-600 font-mono">{item.label}</span>
                      {item.amount != null && (
                        <span className="text-xs font-semibold text-slate-800 tabular">{formatCurrency(item.amount)}</span>
                      )}
                    </div>
                    <p className="text-xs text-slate-600 truncate mt-0.5">{item.detail}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] text-slate-400">{formatDate(item.date)}</span>
                      {item.status && <Badge status={item.status} />}
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        </div>

        {/* Revenue vs Expenses */}
        <div className="xl:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-sm p-6 card-lift">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Revenue vs costs</h2>
              <p className="text-xs text-slate-400 mt-0.5">Monthly — includes expenses, bills &amp; payroll in costs</p>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={chartMonthly} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="gradRevenue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradExpenses" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.12} />
                  <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip content={<CustomTooltip />} />
              <Area type="monotone" dataKey="revenue" name="Revenue" stroke="#6366f1" strokeWidth={2.5} fill="url(#gradRevenue)" />
              <Area type="monotone" dataKey="totalExpenses" name="Costs" stroke="#f43f5e" strokeWidth={2.5} fill="url(#gradExpenses)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* AR Aging */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 card-lift">
          <div className="mb-4">
            <h2 className="text-base font-semibold text-slate-900">AR aging</h2>
            <p className="text-xs text-slate-400 mt-0.5">Outstanding receivables by due date</p>
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <PieChart>
              <Pie data={agingData} cx="50%" cy="50%" innerRadius={48} outerRadius={72} paddingAngle={3} dataKey="value">
                {agingData.map((_, i) => <Cell key={i} fill={AGING_COLORS[i]} strokeWidth={0} />)}
              </Pie>
              <Tooltip formatter={(v) => formatCurrency(Number(v))} />
            </PieChart>
          </ResponsiveContainer>
          <div className="space-y-2 mt-3">
            {agingData.map((item, i) => (
              <div key={i} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-sm" style={{ background: AGING_COLORS[i] }} />
                  <span className="text-xs text-slate-500">{item.name}</span>
                </div>
                <span className="text-xs font-semibold text-slate-700 tabular">{formatCurrency(item.value)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Status breakdown */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 card-lift">
          <h2 className="text-base font-semibold text-slate-900 mb-4">Status breakdown</h2>
          <div className="space-y-4">
            <StatusGroup title="Invoices" items={data?.statusBreakdown.invoices.map((s) => ({ status: s.status, count: s._count, total: s._sum.total })) ?? []} />
            <StatusGroup title="Bills" items={data?.statusBreakdown.bills.map((s) => ({ status: s.status, count: s._count, total: s._sum.total })) ?? []} />
            <StatusGroup title="Expenses" items={data?.statusBreakdown.expenses.map((s) => ({ status: s.status, count: s._count, total: s._sum.total })) ?? []} />
            <StatusGroup title="Journal" items={data?.statusBreakdown.journal.map((s) => ({ status: s.status, count: s._count })) ?? []} showAmount={false} />
          </div>
        </div>
      </div>

      {chartMonthly.some((d) => d.revenue > 0 || d.totalExpenses > 0) && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 card-lift">
          <div className="mb-5">
            <h2 className="text-base font-semibold text-slate-900">Monthly profit</h2>
            <p className="text-xs text-slate-400 mt-0.5">Revenue minus all costs per month</p>
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={chartMonthly} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="profit" name="Net profit" fill="#6366f1" radius={[6, 6, 0, 0]} maxBarSize={48} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Recent tables */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <RecentTable
          title="Recent invoices"
          link="/invoices"
          icon={<FileText size={16} className="text-indigo-500" />}
          loading={loading}
          rows={data?.recentInvoices ?? []}
          cols={[
            { label: 'Invoice', render: (r) => <span className="font-semibold text-indigo-600 text-xs font-mono">{r.invoiceNo}</span> },
            { label: 'Customer', render: (r) => <span className="text-slate-700 text-sm">{r.customer.name}</span> },
            { label: 'Amount', render: (r) => <span className="font-semibold tabular text-sm">{formatCurrency(r.total)}</span>, right: true },
            { label: 'Status', render: (r) => <Badge status={r.status} /> },
          ]}
          emptyMsg="No invoices yet"
        />
        <RecentTable
          title="Recent bills"
          link="/bills"
          icon={<Receipt size={16} className="text-rose-500" />}
          loading={loading}
          rows={data?.recentBills ?? []}
          cols={[
            { label: 'Bill', render: (r) => <span className="font-semibold text-indigo-600 text-xs font-mono">{r.billNo}</span> },
            { label: 'Vendor', render: (r) => <span className="text-slate-700 text-sm">{r.vendor.name}</span> },
            { label: 'Amount', render: (r) => <span className="font-semibold tabular text-sm">{formatCurrency(r.total)}</span>, right: true },
            { label: 'Status', render: (r) => <Badge status={r.status} /> },
          ]}
          emptyMsg="No bills yet"
        />
        <RecentTable
          title="Recent expenses"
          link="/expenses"
          icon={<CreditCard size={16} className="text-orange-500" />}
          loading={loading}
          rows={data?.recentExpenses ?? []}
          cols={[
            { label: 'Expense', render: (r) => <span className="font-semibold text-indigo-600 text-xs font-mono">{r.expenseNo}</span> },
            { label: 'Description', render: (r) => <span className="text-slate-700 text-sm truncate max-w-[140px] block">{r.description}</span> },
            { label: 'Amount', render: (r) => <span className="font-semibold tabular text-sm">{formatCurrency(r.total)}</span>, right: true },
            { label: 'Status', render: (r) => <Badge status={r.status} /> },
          ]}
          emptyMsg="No expenses yet"
        />
        <RecentTable
          title="Recent journal entries"
          link="/journal"
          icon={<BookOpen size={16} className="text-violet-500" />}
          loading={loading}
          rows={data?.recentJournal ?? []}
          cols={[
            { label: 'Entry', render: (r) => <span className="font-semibold text-indigo-600 text-xs font-mono">{r.entryNo}</span> },
            { label: 'Description', render: (r) => <span className="text-slate-700 text-sm truncate max-w-[140px] block">{r.description}</span> },
            { label: 'Debit', render: (r) => <span className="font-semibold tabular text-sm">{formatCurrency(r.totalDebit)}</span>, right: true },
            { label: 'Status', render: (r) => <Badge status={r.status} /> },
          ]}
          emptyMsg="No journal entries yet"
        />
        <RecentTable
          title="Recent payroll"
          link="/payroll"
          icon={<DollarSign size={16} className="text-emerald-500" />}
          loading={loading}
          rows={data?.recentPayroll ?? []}
          cols={[
            { label: 'Payroll', render: (r) => <span className="font-semibold text-indigo-600 text-xs font-mono">{r.payrollNo}</span> },
            { label: 'Employee', render: (r) => <span className="text-slate-700 text-sm">{r.employee.name}</span> },
            { label: 'Net', render: (r) => <span className="font-semibold tabular text-sm">{formatCurrency(r.netSalary)}</span>, right: true },
            { label: 'Status', render: (r) => <Badge status={r.status} /> },
          ]}
          emptyMsg="No payroll runs yet"
        />
      </div>
    </div>
  )
}

function KpiCard({ title, value, sub, color, icon, loading }: {
  title: string; value: string; sub: string
  color: string; icon: React.ReactNode; loading?: boolean
}) {
  return (
    <div className="relative bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden card-lift">
      <div className="p-5">
        {loading ? (
          <div className="space-y-3">
            <div className="skeleton h-3 w-24" />
            <div className="skeleton h-7 w-32" />
            <div className="skeleton h-3 w-16" />
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between mb-3">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{title}</p>
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center shadow-sm ${color}`}>{icon}</div>
            </div>
            <p className="text-2xl font-bold text-slate-900 tabular leading-none">{value}</p>
            <p className="text-xs text-slate-400 mt-2">{sub}</p>
          </>
        )}
      </div>
      <div className={`h-0.5 w-full ${color} opacity-60`} />
    </div>
  )
}

function MiniKpi({ label, value, loading }: { label: string; value: string; loading?: boolean }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 px-4 py-3">
      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">{label}</p>
      <p className="text-sm font-bold text-slate-900 tabular mt-1">{loading ? '—' : value}</p>
    </div>
  )
}

function StatusGroup({ title, items, showAmount = true }: {
  title: string
  items: { status: string; count: number; total?: number | null }[]
  showAmount?: boolean
}) {
  if (!items.length) return null
  return (
    <div>
      <p className="text-xs font-semibold text-slate-500 mb-2">{title}</p>
      <div className="flex flex-wrap gap-2">
        {items.map((s) => (
          <div key={s.status} className="flex items-center gap-2 px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-100 text-xs">
            <Badge status={s.status} />
            <span className="text-slate-600 font-medium">{s.count}</span>
            {showAmount && s.total != null && s.total > 0 && (
              <span className="text-slate-400 tabular">{formatCurrency(s.total)}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

interface Col<T> {
  label: string
  render: (r: T) => React.ReactNode
  right?: boolean
}

function RecentTable<T extends { id: string }>({
  title, link, icon, loading, rows, cols, emptyMsg,
}: {
  title: string; link: string; icon: React.ReactNode
  loading: boolean; rows: T[]; cols: Col<T>[]; emptyMsg: string
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden card-lift">
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
        <div className="flex items-center gap-2">
          {icon}
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        </div>
        <Link href={link} className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 font-semibold">
          View all
        </Link>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full data-table">
          <thead>
            <tr className="border-b border-slate-50">
              {cols.map((c, i) => (
                <th key={i} className={`px-4 py-2.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider ${c.right ? 'text-right' : 'text-left'}`}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <tr key={i}>
                  {cols.map((_, j) => (
                    <td key={j} className="px-4 py-3"><div className="skeleton h-4 w-full" /></td>
                  ))}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={cols.length} className="px-4 py-8 text-center text-slate-400 text-sm">{emptyMsg}</td>
              </tr>
            ) : rows.map((row) => (
              <tr key={row.id}>
                {cols.map((c, j) => (
                  <td key={j} className={`px-4 py-3 ${c.right ? 'text-right' : ''}`}>{c.render(row)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
