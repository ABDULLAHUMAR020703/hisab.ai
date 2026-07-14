import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCompanyId } from '@/lib/tenant'
import { prisma } from '@/lib/prisma'
import { buildInventoryValuationReport } from '@/lib/inventory/valuation'
import { findSystemAccount } from '@/lib/accounting/posting-service'
import { queryLedgerEntries } from '@/lib/accounting/ledger'
import type { ReportRunRequest } from '../types'

export async function runSalesSummary(req: ReportRunRequest) {
  const from = new Date(req.period!.from)
  const to = new Date(req.period!.to)
  const invoices = await prisma.invoice.findMany({
    where: { date: { gte: from, lte: to }, status: { in: ['SENT', 'PAID', 'PARTIAL'] } },
    include: { customer: { select: { name: true } } },
    orderBy: { date: 'desc' },
  })

  const rows = invoices.map((inv: {
    invoiceNo: string; date: Date; subtotal: number; taxAmount: number; total: number; balance: number; status: string
    customer: { name: string } | null
  }) => ({
    invoiceNo: inv.invoiceNo,
    date: inv.date,
    customerName: inv.customer?.name ?? '',
    subtotal: inv.subtotal,
    taxAmount: inv.taxAmount,
    total: inv.total,
    balance: inv.balance,
    status: inv.status,
  }))

  return {
    period: { from: from.toISOString(), to: to.toISOString() },
    rows,
    summary: {
      count: rows.length,
      totalSales: rows.reduce((s: number, r: { total: number }) => s + r.total, 0),
      totalTax: rows.reduce((s: number, r: { taxAmount: number }) => s + r.taxAmount, 0),
      outstanding: rows.reduce((s: number, r: { balance: number }) => s + r.balance, 0),
    },
  }
}

export async function runPurchaseSummary(req: ReportRunRequest) {
  const from = new Date(req.period!.from)
  const to = new Date(req.period!.to)
  const bills = await prisma.bill.findMany({
    where: { date: { gte: from, lte: to }, status: { in: ['RECEIVED', 'PAID', 'PARTIAL'] } },
    include: { vendor: { select: { name: true } } },
    orderBy: { date: 'desc' },
  })

  const rows = bills.map((bill: {
    billNo: string; date: Date; subtotal: number; taxAmount: number; total: number; balance: number; status: string
    vendor: { name: string } | null
  }) => ({
    billNo: bill.billNo,
    date: bill.date,
    vendorName: bill.vendor?.name ?? '',
    subtotal: bill.subtotal,
    taxAmount: bill.taxAmount,
    total: bill.total,
    balance: bill.balance,
    status: bill.status,
  }))

  return {
    period: { from: from.toISOString(), to: to.toISOString() },
    rows,
    summary: {
      count: rows.length,
      totalPurchases: rows.reduce((s: number, r: { total: number }) => s + r.total, 0),
      totalTax: rows.reduce((s: number, r: { taxAmount: number }) => s + r.taxAmount, 0),
      outstanding: rows.reduce((s: number, r: { balance: number }) => s + r.balance, 0),
    },
  }
}

export async function runExpenseSummary(req: ReportRunRequest) {
  const companyId = req.companyId ?? await resolveCompanyId()
  const client = createAdminClient()
  const from = new Date(req.period!.from)
  const to = new Date(req.period!.to)

  const { data, error } = await client
    .from('expenses')
    .select('expense_no, date, description, category, total, tax_amount, status')
    .eq('company_id', companyId)
    .gte('date', from.toISOString())
    .lte('date', to.toISOString())
    .order('date', { ascending: false })

  if (error) throw error

  const rows = (data ?? []).map((e) => ({
    expenseNo: e.expense_no,
    date: e.date,
    description: e.description,
    category: e.category,
    total: Number(e.total ?? 0),
    taxAmount: Number(e.tax_amount ?? 0),
    status: e.status,
  }))

  return {
    period: { from: from.toISOString(), to: to.toISOString() },
    rows,
    summary: {
      count: rows.length,
      totalExpenses: rows.reduce((s, r) => s + r.total, 0),
      byCategory: Object.entries(
        rows.reduce<Record<string, number>>((acc, r) => {
          acc[r.category] = (acc[r.category] ?? 0) + r.total
          return acc
        }, {}),
      ).map(([category, amount]) => ({ category, amount })),
    },
  }
}

export async function runInventoryValuation(req: ReportRunRequest) {
  return buildInventoryValuationReport({ companyId: req.companyId })
}

export async function runInventoryMovement(req: ReportRunRequest) {
  const companyId = req.companyId ?? await resolveCompanyId()
  const client = createAdminClient()
  const from = new Date(req.period!.from)
  const to = new Date(req.period!.to)

  const { data, error } = await client
    .from('inventory_audit_logs')
    .select('created_at, action, entity_type, reason, item:inventory_items(name), warehouse:warehouses(name)')
    .eq('company_id', companyId)
    .gte('created_at', from.toISOString())
    .lte('created_at', to.toISOString())
    .order('created_at', { ascending: false })

  if (error) throw error

  const rows = (data ?? []).map((m) => ({
    date: m.created_at,
    action: m.action,
    entityType: m.entity_type,
    itemName: (m.item as { name?: string } | null)?.name ?? '',
    warehouse: (m.warehouse as { name?: string } | null)?.name ?? '',
    reason: m.reason ?? '',
  }))

  return { period: { from: from.toISOString(), to: to.toISOString() }, rows }
}

export async function runPayrollSummary(req: ReportRunRequest) {
  const from = new Date(req.period!.from)
  const to = new Date(req.period!.to)
  const entries = await prisma.payrollEntry.findMany({
    where: { periodStart: { gte: from }, periodEnd: { lte: to } },
    include: { employee: { select: { name: true, departmentId: true } } },
    orderBy: { periodStart: 'desc' },
  })

  const rows = entries.map((p: {
    payrollNo: string; period: string; basicSalary: number; allowances: number; deductions: number
    taxAmount: number; netSalary: number; status: string
    employee: { name: string } | null
  }) => ({
    payrollNo: p.payrollNo,
    employeeName: p.employee?.name ?? '',
    period: p.period,
    grossSalary: p.basicSalary + p.allowances,
    deductions: p.deductions,
    taxAmount: p.taxAmount,
    netSalary: p.netSalary,
    status: p.status,
  }))

  return {
    period: { from: from.toISOString(), to: to.toISOString() },
    rows,
    summary: {
      count: rows.length,
      totalGross: rows.reduce((s: number, r: { grossSalary: number }) => s + r.grossSalary, 0),
      totalNet: rows.reduce((s: number, r: { netSalary: number }) => s + r.netSalary, 0),
    },
  }
}

export async function runTaxReport(req: ReportRunRequest) {
  const companyId = req.companyId ?? await resolveCompanyId()
  const from = new Date(req.period!.from)
  const to = new Date(req.period!.to)

  const [vatPayableId, vatReceivableId] = await Promise.all([
    findSystemAccount(companyId, { nameContains: 'VAT Payable' }),
    findSystemAccount(companyId, { nameContains: 'VAT Receivable' }),
  ])

  let vatCollected = 0
  let vatPaid = 0
  let ledgerUsed = false

  if (vatPayableId || vatReceivableId) {
    const ledgerRows = await queryLedgerEntries({ companyId, from, to })
    const payableCredit = ledgerRows.filter((r) => r.accountId === vatPayableId).reduce((s, r) => s + r.credit - r.debit, 0)
    const receivableDebit = ledgerRows.filter((r) => r.accountId === vatReceivableId).reduce((s, r) => s + r.debit - r.credit, 0)
    if (payableCredit > 0 || receivableDebit > 0) {
      vatCollected = payableCredit
      vatPaid = receivableDebit
      ledgerUsed = true
    }
  }

  const invoices = await prisma.invoice.findMany({
    where: { date: { gte: from, lte: to }, status: { in: ['SENT', 'PAID', 'PARTIAL'] } },
    select: { taxAmount: true, subtotal: true },
  })
  const salesAmount = invoices.reduce((s: number, i: { subtotal: number }) => s + i.subtotal, 0)
  if (!ledgerUsed) vatCollected = invoices.reduce((s: number, i: { taxAmount: number }) => s + i.taxAmount, 0)

  const bills = await prisma.bill.findMany({
    where: { date: { gte: from, lte: to }, status: { in: ['RECEIVED', 'PAID', 'PARTIAL'] } },
    select: { taxAmount: true, subtotal: true },
  })
  const purchasesAmount = bills.reduce((s: number, b: { subtotal: number }) => s + b.subtotal, 0)
  if (!ledgerUsed) vatPaid = bills.reduce((s: number, b: { taxAmount: number }) => s + b.taxAmount, 0)

  const vatPayable = vatCollected - vatPaid

  return {
    period: { from: from.toISOString(), to: to.toISOString() },
    sales: { amount: salesAmount, vatCollected, invoiceCount: invoices.length },
    purchases: { amount: purchasesAmount, vatPaid, billCount: bills.length },
    vatPayable,
    summary: vatPayable > 0 ? 'VAT PAYABLE TO ZATCA' : 'VAT REFUNDABLE FROM ZATCA',
    source: ledgerUsed ? 'ledger_entries' : 'documents',
    rows: [
      { line: 'Sales (ex VAT)', amount: salesAmount },
      { line: 'VAT Collected', amount: vatCollected },
      { line: 'Purchases (ex VAT)', amount: purchasesAmount },
      { line: 'VAT Paid', amount: vatPaid },
      { line: 'Net VAT Payable', amount: vatPayable },
    ],
  }
}

export async function runBankSummary(req: ReportRunRequest) {
  const companyId = req.companyId ?? await resolveCompanyId()
  const client = createAdminClient()
  const from = new Date(req.period!.from)
  const to = new Date(req.period!.to)

  const { data: accounts, error: accError } = await client
    .from('chart_of_accounts')
    .select('id, account_no, name')
    .eq('company_id', companyId)
    .eq('canonical_type', 'Asset')
    .or('account_type.eq.Bank,sub_type.eq.Cash and Cash Equivalents')
    .is('deleted_at', null)

  if (accError) throw accError

  const rows = []
  for (const acc of accounts ?? []) {
    const { data: entries } = await client
      .from('ledger_entries')
      .select('debit, credit')
      .eq('company_id', companyId)
      .eq('account_id', acc.id)
      .gte('entry_date', from.toISOString())
      .lte('entry_date', to.toISOString())

    const inflows = (entries ?? []).reduce((s, e) => s + Number(e.debit ?? 0), 0)
    const outflows = (entries ?? []).reduce((s, e) => s + Number(e.credit ?? 0), 0)
    rows.push({
      accountNo: acc.account_no,
      accountName: acc.name,
      inflows,
      outflows,
      net: inflows - outflows,
    })
  }

  return {
    period: { from: from.toISOString(), to: to.toISOString() },
    rows,
    summary: {
      totalInflows: rows.reduce((s, r) => s + r.inflows, 0),
      totalOutflows: rows.reduce((s, r) => s + r.outflows, 0),
      netCash: rows.reduce((s, r) => s + r.net, 0),
    },
  }
}

export async function runTopCustomers(req: ReportRunRequest) {
  const from = new Date(req.period!.from)
  const to = new Date(req.period!.to)
  const limit = req.pageSize ?? 10

  const invoices = await prisma.invoice.findMany({
    where: { date: { gte: from, lte: to }, status: { in: ['SENT', 'PAID', 'PARTIAL'] } },
    include: { customer: { select: { id: true, name: true } } },
  })

  const totals = new Map<string, { name: string; total: number; count: number }>()
  for (const inv of invoices) {
    const id = inv.customerId ?? 'unknown'
    const bucket = totals.get(id) ?? { name: inv.customer?.name ?? 'Unknown', total: 0, count: 0 }
    bucket.total += inv.total
    bucket.count += 1
    totals.set(id, bucket)
  }

  const rows = [...totals.values()]
    .sort((a, b) => b.total - a.total)
    .slice(0, limit)
    .map((t, i) => ({ rank: i + 1, customerName: t.name, total: t.total, invoiceCount: t.count }))

  return { period: { from: from.toISOString(), to: to.toISOString() }, rows }
}

export async function runTopVendors(req: ReportRunRequest) {
  const from = new Date(req.period!.from)
  const to = new Date(req.period!.to)
  const limit = req.pageSize ?? 10

  const bills = await prisma.bill.findMany({
    where: { date: { gte: from, lte: to }, status: { in: ['RECEIVED', 'PAID', 'PARTIAL'] } },
    include: { vendor: { select: { id: true, name: true } } },
  })

  const totals = new Map<string, { name: string; total: number; count: number }>()
  for (const bill of bills) {
    const id = bill.vendorId ?? 'unknown'
    const bucket = totals.get(id) ?? { name: bill.vendor?.name ?? 'Unknown', total: 0, count: 0 }
    bucket.total += bill.total
    bucket.count += 1
    totals.set(id, bucket)
  }

  const rows = [...totals.values()]
    .sort((a, b) => b.total - a.total)
    .slice(0, limit)
    .map((t, i) => ({ rank: i + 1, vendorName: t.name, total: t.total, billCount: t.count }))

  return { period: { from: from.toISOString(), to: to.toISOString() }, rows }
}

export async function runTopProducts(req: ReportRunRequest) {
  const from = new Date(req.period!.from)
  const to = new Date(req.period!.to)
  const limit = req.pageSize ?? 10

  const invoices = await prisma.invoice.findMany({
    where: { date: { gte: from, lte: to }, status: { in: ['SENT', 'PAID', 'PARTIAL'] } },
    include: { lines: { select: { description: true, quantity: true, amount: true } } },
  })

  const totals = new Map<string, { total: number; quantity: number }>()
  for (const inv of invoices) {
    for (const line of inv.lines) {
      const key = line.description || 'Item'
      const bucket = totals.get(key) ?? { total: 0, quantity: 0 }
      bucket.total += line.amount
      bucket.quantity += line.quantity
      totals.set(key, bucket)
    }
  }

  const rows = [...totals.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, limit)
    .map(([product, stats], i) => ({ rank: i + 1, product, total: stats.total, quantity: stats.quantity }))

  return { period: { from: from.toISOString(), to: to.toISOString() }, rows }
}

export async function runCostCenterReport(req: ReportRunRequest) {
  const companyId = req.companyId ?? await resolveCompanyId()
  const client = createAdminClient()
  const from = new Date(req.period!.from)
  const to = new Date(req.period!.to)

  const { data, error } = await client
    .from('ledger_entries')
    .select('debit, credit, cost_center:cost_centers(id, name, code)')
    .eq('company_id', companyId)
    .gte('entry_date', from.toISOString())
    .lte('entry_date', to.toISOString())
    .not('cost_center_id', 'is', null)

  if (error) throw error

  const totals = new Map<string, { name: string; code: string; debit: number; credit: number }>()
  for (const row of data ?? []) {
    const cc = row.cost_center as { id?: string; name?: string; code?: string } | null
    const key = cc?.id ?? 'unknown'
    const bucket = totals.get(key) ?? { name: cc?.name ?? '', code: cc?.code ?? '', debit: 0, credit: 0 }
    bucket.debit += Number(row.debit ?? 0)
    bucket.credit += Number(row.credit ?? 0)
    totals.set(key, bucket)
  }

  const rows = [...totals.values()].map((t) => ({
    costCenter: t.name,
    code: t.code,
    debit: t.debit,
    credit: t.credit,
    net: t.debit - t.credit,
  }))

  return { period: { from: from.toISOString(), to: to.toISOString() }, rows }
}

export async function runDepartmentProfitability(req: ReportRunRequest) {
  const companyId = req.companyId ?? await resolveCompanyId()
  const client = createAdminClient()
  const from = new Date(req.period!.from)
  const to = new Date(req.period!.to)

  const { data: payroll } = await client
    .from('payroll_entries')
    .select('net_salary, employee:employees(department:departments(name))')
    .eq('company_id', companyId)
    .gte('period_start', from.toISOString())
    .lte('period_end', to.toISOString())

  const totals = new Map<string, number>()
  for (const row of payroll ?? []) {
    const dept = (row.employee as { department?: { name?: string } } | null)?.department?.name ?? 'Unassigned'
    totals.set(dept, (totals.get(dept) ?? 0) + Number(row.net_salary ?? 0))
  }

  const rows = [...totals.entries()].map(([department, payrollCost]) => ({ department, payrollCost }))
  return { period: { from: from.toISOString(), to: to.toISOString() }, rows }
}
