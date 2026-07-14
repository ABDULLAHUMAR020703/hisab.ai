import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCompanyId } from '@/lib/tenant'
import { aggregateLedgerBalances } from './ledger'

export async function buildCashFlowFromLedger(options: {
  from: Date
  to: Date
  companyId?: string
}) {
  const companyId = options.companyId ?? await resolveCompanyId()
  const client = createAdminClient()

  const { data: bankAccounts, error: bankError } = await client
    .from('chart_of_accounts')
    .select('id, account_no, name')
    .eq('company_id', companyId)
    .eq('canonical_type', 'Asset')
    .or('account_type.eq.Bank,sub_type.eq.Cash and Cash Equivalents')
    .is('deleted_at', null)

  if (bankError) throw bankError

  const bankIds = new Set((bankAccounts ?? []).map((a) => String(a.id)))

  const balances = await aggregateLedgerBalances({
    companyId,
    from: options.from,
    to: options.to,
  })

  let operatingInflows = 0
  let operatingOutflows = 0
  let investingInflows = 0
  let investingOutflows = 0
  let financingInflows = 0
  let financingOutflows = 0

  const { data: ledgerRows, error: ledgerError } = await client
    .from('ledger_entries')
    .select('account_id, debit, credit, entry_date, source_type')
    .eq('company_id', companyId)
    .gte('entry_date', options.from.toISOString())
    .lte('entry_date', options.to.toISOString())

  if (ledgerError) throw ledgerError

  for (const row of ledgerRows ?? []) {
    if (!bankIds.has(String(row.account_id))) continue
    const debit = Number(row.debit ?? 0)
    const credit = Number(row.credit ?? 0)
    const inflow = debit
    const outflow = credit
    const sourceType = String(row.source_type)

    if (['INVOICE', 'BILL', 'EXPENSE', 'PAYMENT', 'PAYROLL'].includes(sourceType)) {
      operatingInflows += inflow
      operatingOutflows += outflow
    } else if (sourceType === 'ADJUSTMENT') {
      investingInflows += inflow
      investingOutflows += outflow
    } else {
      financingInflows += inflow
      financingOutflows += outflow
    }
  }

  const totalInflows = operatingInflows + investingInflows + financingInflows
  const totalOutflows = operatingOutflows + investingOutflows + financingOutflows

  const monthlyMap: Record<string, { inflows: number; outflows: number }> = {}
  for (const row of ledgerRows ?? []) {
    if (!bankIds.has(String(row.account_id))) continue
    const key = String(row.entry_date).substring(0, 7)
    if (!monthlyMap[key]) monthlyMap[key] = { inflows: 0, outflows: 0 }
    monthlyMap[key].inflows += Number(row.debit ?? 0)
    monthlyMap[key].outflows += Number(row.credit ?? 0)
  }

  const monthly = Object.entries(monthlyMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, data]) => ({ month, ...data, net: data.inflows - data.outflows }))

  return {
    period: { from: options.from.toISOString(), to: options.to.toISOString() },
    operating: { inflows: operatingInflows, outflows: operatingOutflows, net: operatingInflows - operatingOutflows },
    investing: { inflows: investingInflows, outflows: investingOutflows, net: investingInflows - investingOutflows },
    financing: { inflows: financingInflows, outflows: financingOutflows, net: financingInflows - financingOutflows },
    totalInflows,
    totalOutflows,
    netCashFlow: totalInflows - totalOutflows,
    monthly,
    bankAccountCount: bankIds.size,
  }
}
