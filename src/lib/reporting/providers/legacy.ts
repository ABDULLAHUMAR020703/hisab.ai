import 'server-only'
import {
  buildTrialBalance,
  buildBalanceSheetFromLedger,
  buildProfitLossFromLedger,
} from '@/lib/accounting/trial-balance'
import { buildCashFlowFromLedger } from '@/lib/accounting/cash-flow'
import { getGeneralLedgerReport } from '@/lib/accounting/ledger'
import { buildAgedPayablesReport, buildAgedReceivablesReport } from '../aging'
import type { ReportRunRequest } from '../types'

/** Delegates to existing accounting report builders — calculations unchanged. */
export async function runLegacyReport(reportKey: string, req: ReportRunRequest) {
  const companyId = req.companyId
  const from = req.period?.from ? new Date(req.period.from) : new Date(new Date().getFullYear(), 0, 1)
  const to = req.period?.to ? new Date(req.period.to) : new Date()
  const asOf = req.asOf ? new Date(req.asOf) : to

  switch (reportKey) {
    case 'trial-balance':
      return buildTrialBalance({ asOf, from: req.period?.from ? from : undefined, to, companyId })
    case 'balance-sheet':
      return buildBalanceSheetFromLedger({ asOf, companyId })
    case 'profit-loss':
      return buildProfitLossFromLedger({ from, to, companyId })
    case 'cash-flow':
      return buildCashFlowFromLedger({ from, to, companyId })
    case 'general-ledger': {
      const accountId = req.filters?.find((f: { field: string }) => f.field === 'accountId')?.value as string | undefined
      const page = req.page ?? 1
      const pageSize = req.pageSize ?? 500
      return getGeneralLedgerReport({
        accountId,
        from,
        to,
        companyId,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      })
    }
    case 'aged-ar':
    case 'customer-aging':
      return buildAgedReceivablesReport(asOf)
    case 'aged-ap':
    case 'vendor-aging':
      return buildAgedPayablesReport(asOf)
    default:
      return null
  }
}
