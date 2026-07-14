import 'server-only'
import { buildProfitLossFromLedger, buildBalanceSheetFromLedger } from '@/lib/accounting/trial-balance'
import { buildCashFlowFromLedger } from '@/lib/accounting/cash-flow'
import { buildAgedReceivablesReport, buildAgedPayablesReport } from '../aging'
import { monthlyBuckets } from '../periods'
import { runBudgetVsActual } from './financial-extended'
import type { ReportRunRequest } from '../types'

export async function runExecutiveDashboard(req: ReportRunRequest) {
  const from = new Date(req.period!.from)
  const to = new Date(req.period!.to)
  const [pl, bs, cf, ar, ap] = await Promise.all([
    buildProfitLossFromLedger({ from, to, companyId: req.companyId }),
    buildBalanceSheetFromLedger({ asOf: to, companyId: req.companyId }),
    buildCashFlowFromLedger({ from, to, companyId: req.companyId }),
    buildAgedReceivablesReport(to),
    buildAgedPayablesReport(to),
  ])

  return {
    period: { from: from.toISOString(), to: to.toISOString() },
    kpis: {
      revenue: pl.revenue.total,
      netProfit: pl.netProfit,
      grossMargin: pl.revenue.total > 0 ? (pl.grossProfit / pl.revenue.total) * 100 : 0,
      totalAssets: bs.assets.total,
      totalLiabilities: bs.liabilities.total,
      equity: bs.equity.total,
      cashFlow: cf.netCashFlow,
      accountsReceivable: ar.grandTotal,
      accountsPayable: ap.grandTotal,
      workingCapital: bs.assets.total - bs.liabilities.total,
    },
    profitLoss: pl,
    balanceSheet: bs,
    cashFlow: cf,
  }
}

export async function runRevenueTrends(req: ReportRunRequest) {
  const from = new Date(req.period!.from)
  const to = new Date(req.period!.to)
  const buckets = monthlyBuckets(from, to)
  const rows = []

  for (const bucket of buckets) {
    const pl = await buildProfitLossFromLedger({
      from: bucket.from,
      to: bucket.to,
      companyId: req.companyId,
    })
    rows.push({
      month: bucket.key,
      label: bucket.label,
      revenue: pl.revenue.total,
      expenses: pl.expenses.total,
      netProfit: pl.netProfit,
    })
  }

  return { period: { from: from.toISOString(), to: to.toISOString() }, rows }
}

export async function runExpenseTrends(req: ReportRunRequest) {
  const from = new Date(req.period!.from)
  const to = new Date(req.period!.to)
  const buckets = monthlyBuckets(from, to)
  const rows = []

  for (const bucket of buckets) {
    const pl = await buildProfitLossFromLedger({
      from: bucket.from,
      to: bucket.to,
      companyId: req.companyId,
    })
    rows.push({
      month: bucket.key,
      label: bucket.label,
      cogs: pl.cogs.total,
      expenses: pl.expenses.total,
      totalCosts: pl.cogs.total + pl.expenses.total,
    })
  }

  return { period: { from: from.toISOString(), to: to.toISOString() }, rows }
}

export async function runCashPosition(req: ReportRunRequest) {
  const from = new Date(req.period!.from)
  const to = new Date(req.period!.to)
  const cf = await buildCashFlowFromLedger({ from, to, companyId: req.companyId })
  return {
    period: { from: from.toISOString(), to: to.toISOString() },
    operating: cf.operating,
    investing: cf.investing,
    financing: cf.financing,
    totalInflows: cf.totalInflows,
    totalOutflows: cf.totalOutflows,
    netCashFlow: cf.netCashFlow,
    monthly: cf.monthly,
    rows: cf.monthly.map((m) => ({ month: m.month, inflows: m.inflows, outflows: m.outflows, net: m.net })),
  }
}

export async function runWorkingCapital(req: ReportRunRequest) {
  const asOf = new Date(req.asOf ?? req.period?.to ?? new Date())
  const [bs, ar, ap] = await Promise.all([
    buildBalanceSheetFromLedger({ asOf, companyId: req.companyId }),
    buildAgedReceivablesReport(asOf),
    buildAgedPayablesReport(asOf),
  ])

  const currentAssets = bs.assets.total
  const currentLiabilities = bs.liabilities.total
  const workingCapital = currentAssets - currentLiabilities

  return {
    asOf: asOf.toISOString(),
    currentAssets,
    currentLiabilities,
    accountsReceivable: ar.grandTotal,
    accountsPayable: ap.grandTotal,
    workingCapital,
    netWorkingCapital: ar.grandTotal - ap.grandTotal,
    rows: [
      { metric: 'Current Assets', amount: currentAssets },
      { metric: 'Current Liabilities', amount: currentLiabilities },
      { metric: 'Accounts Receivable', amount: ar.grandTotal },
      { metric: 'Accounts Payable', amount: ap.grandTotal },
      { metric: 'Working Capital', amount: workingCapital },
    ],
  }
}

export async function runProfitMargins(req: ReportRunRequest) {
  const from = new Date(req.period!.from)
  const to = new Date(req.period!.to)
  const pl = await buildProfitLossFromLedger({ from, to, companyId: req.companyId })
  const revenue = pl.revenue.total

  return {
    period: { from: from.toISOString(), to: to.toISOString() },
    grossMargin: revenue > 0 ? (pl.grossProfit / revenue) * 100 : 0,
    operatingMargin: revenue > 0 ? ((pl.grossProfit - pl.expenses.total) / revenue) * 100 : 0,
    netMargin: revenue > 0 ? (pl.netProfit / revenue) * 100 : 0,
    rows: [
      { margin: 'Gross Margin %', value: revenue > 0 ? (pl.grossProfit / revenue) * 100 : 0 },
      { margin: 'Net Margin %', value: revenue > 0 ? (pl.netProfit / revenue) * 100 : 0 },
    ],
  }
}

export async function runReceivableTurnover(req: ReportRunRequest) {
  const from = new Date(req.period!.from)
  const to = new Date(req.period!.to)
  const [pl, ar] = await Promise.all([
    buildProfitLossFromLedger({ from, to, companyId: req.companyId }),
    buildAgedReceivablesReport(to),
  ])
  const avgReceivables = ar.grandTotal
  const turnover = avgReceivables > 0 ? pl.revenue.total / avgReceivables : 0
  const dso = turnover > 0 ? 365 / turnover : 0

  return {
    period: { from: from.toISOString(), to: to.toISOString() },
    revenue: pl.revenue.total,
    averageReceivables: avgReceivables,
    turnover,
    daysSalesOutstanding: dso,
    rows: [{ metric: 'Receivable Turnover', value: turnover }, { metric: 'DSO (days)', value: dso }],
  }
}

export async function runPayableTurnover(req: ReportRunRequest) {
  const from = new Date(req.period!.from)
  const to = new Date(req.period!.to)
  const purchases = await buildProfitLossFromLedger({ from, to, companyId: req.companyId })
  const ap = await buildAgedPayablesReport(to)
  const cogs = purchases.cogs.total + purchases.expenses.total
  const turnover = ap.grandTotal > 0 ? cogs / ap.grandTotal : 0
  const dpo = turnover > 0 ? 365 / turnover : 0

  return {
    period: { from: from.toISOString(), to: to.toISOString() },
    purchases: cogs,
    averagePayables: ap.grandTotal,
    turnover,
    daysPayableOutstanding: dpo,
    rows: [{ metric: 'Payable Turnover', value: turnover }, { metric: 'DPO (days)', value: dpo }],
  }
}

export async function runInventoryTurnover(req: ReportRunRequest) {
  const from = new Date(req.period!.from)
  const to = new Date(req.period!.to)
  const pl = await buildProfitLossFromLedger({ from, to, companyId: req.companyId })
  const cogs = pl.cogs.total
  const turnover = cogs > 0 ? cogs / Math.max(cogs * 0.25, 1) : 0

  return {
    period: { from: from.toISOString(), to: to.toISOString() },
    cogs,
    estimatedTurnover: turnover,
    rows: [{ metric: 'COGS', value: cogs }, { metric: 'Estimated Inventory Turnover', value: turnover }],
  }
}

export async function runBudgetVariance(req: ReportRunRequest) {
  const report = await runBudgetVsActual(req)
  return {
    ...report,
    rows: report.rows.map((r) => ({
      accountName: r.accountName,
      budget: r.budget,
      actual: r.actual,
      variance: r.variance,
      variancePct: r.variancePct,
    })),
  }
}
