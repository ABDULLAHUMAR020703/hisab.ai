import 'server-only'
import { resolveCompanyId } from '@/lib/tenant'
import { buildReportCacheKey, getCachedReport, setCachedReport } from '@/lib/accounting/report-cache'
import { resolvePeriod } from './periods'
import { getReportCatalogEntry } from './registry'
import { runLegacyReport } from './providers/legacy'
import {
  runBudgetVsActual,
  runComparativeBalanceSheet,
  runComparativeProfitLoss,
  runCustomerLedger,
  runEquityStatement,
  runFinancialRatios,
  runJournalReport,
  runRetainedEarnings,
  runVendorLedger,
} from './providers/financial-extended'
import {
  runBankSummary,
  runCostCenterReport,
  runDepartmentProfitability,
  runExpenseSummary,
  runInventoryMovement,
  runInventoryValuation,
  runPayrollSummary,
  runPurchaseSummary,
  runSalesSummary,
  runTaxReport,
  runTopCustomers,
  runTopProducts,
  runTopVendors,
} from './providers/operational'
import {
  runBudgetVariance,
  runCashPosition,
  runExecutiveDashboard,
  runExpenseTrends,
  runInventoryTurnover,
  runPayableTurnover,
  runProfitMargins,
  runReceivableTurnover,
  runRevenueTrends,
  runWorkingCapital,
} from './providers/analytics'
import { buildTabularResult, flattenToRows } from './builder'
import type { ReportRunRequest, ReportRunResult } from './types'

const REPORT_CACHE_TTL = 120_000

async function executeReport(req: ReportRunRequest): Promise<unknown> {
  const key = req.reportKey

  const legacy = await runLegacyReport(key, req)
  if (legacy) return legacy

  switch (key) {
    case 'comparative-profit-loss': return runComparativeProfitLoss(req)
    case 'comparative-balance-sheet': return runComparativeBalanceSheet(req)
    case 'retained-earnings': return runRetainedEarnings(req)
    case 'equity-statement': return runEquityStatement(req)
    case 'financial-ratios': return runFinancialRatios(req)
    case 'budget-vs-actual': return runBudgetVsActual(req)
    case 'journal-report': return runJournalReport(req)
    case 'customer-ledger': return runCustomerLedger(req)
    case 'vendor-ledger': return runVendorLedger(req)
    case 'sales-summary': return runSalesSummary(req)
    case 'purchase-summary': return runPurchaseSummary(req)
    case 'expense-summary': return runExpenseSummary(req)
    case 'inventory-valuation': return runInventoryValuation(req)
    case 'inventory-movement': return runInventoryMovement(req)
    case 'payroll-summary': return runPayrollSummary(req)
    case 'tax-report': return runTaxReport(req)
    case 'bank-summary': return runBankSummary(req)
    case 'top-customers': return runTopCustomers(req)
    case 'top-vendors': return runTopVendors(req)
    case 'top-products': return runTopProducts(req)
    case 'cost-center-report': return runCostCenterReport(req)
    case 'department-profitability': return runDepartmentProfitability(req)
    case 'executive-dashboard': return runExecutiveDashboard(req)
    case 'revenue-trends': return runRevenueTrends(req)
    case 'expense-trends': return runExpenseTrends(req)
    case 'cash-position': return runCashPosition(req)
    case 'working-capital': return runWorkingCapital(req)
    case 'profit-margins': return runProfitMargins(req)
    case 'receivable-turnover': return runReceivableTurnover(req)
    case 'payable-turnover': return runPayableTurnover(req)
    case 'inventory-turnover': return runInventoryTurnover(req)
    case 'budget-variance': return runBudgetVariance(req)
    default:
      throw new Error(`Unknown report: ${key}`)
  }
}

export async function runReport(request: ReportRunRequest): Promise<ReportRunResult> {
  const entry = getReportCatalogEntry(request.reportKey)
  if (!entry) throw new Error(`Unknown report: ${request.reportKey}`)

  const companyId = request.companyId ?? await resolveCompanyId()

  if (!request.period && !request.asOf) {
    const { period, asOf } = resolvePeriod('ytd')
    request.period = period
    if (!request.asOf && ['balance-sheet', 'aged-ar', 'aged-ap', 'working-capital', 'equity-statement'].includes(request.reportKey)) {
      request.asOf = asOf?.toISOString()
    }
  }

  const cacheKey = buildReportCacheKey(request.reportKey, companyId, {
    from: request.period?.from,
    to: request.period?.to,
    asOf: request.asOf,
    page: String(request.page ?? 1),
    pageSize: String(request.pageSize ?? 50),
  })

  let data = getCachedReport<unknown>(cacheKey)
  if (!data) {
    data = await executeReport({ ...request, companyId })
    setCachedReport(cacheKey, data, REPORT_CACHE_TTL)
  }

  const rawRows = flattenToRows(data)
  const tabular = rawRows.length > 0
    ? buildTabularResult({
        rows: rawRows,
        filters: request.filters,
        columns: request.columns,
        grouping: request.grouping,
        sorting: request.sorting,
        page: request.page,
        pageSize: request.pageSize,
      })
    : { rows: undefined, pagination: undefined }

  return {
    reportKey: request.reportKey,
    title: entry.title,
    category: entry.category,
    generatedAt: new Date().toISOString(),
    period: request.period,
    asOf: request.asOf,
    data,
    rows: tabular.rows,
    pagination: tabular.pagination,
    drillDown: {
      available: entry.supportsDrillDown,
      fields: entry.filterFields,
    },
    meta: { legacyCompatible: true },
  }
}
