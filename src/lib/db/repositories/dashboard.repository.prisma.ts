import 'server-only'
import { prisma } from '@/lib/prisma'
import type { DashboardPayload } from '../entities'
import { buildActivityFeed } from './dashboard-activity'
import type { DashboardRepository } from './dashboard.repository.interface'

const OPEN_INVOICE_STATUSES = ['DRAFT', 'SENT', 'PARTIAL', 'OVERDUE']
const OPEN_BILL_STATUSES = ['DRAFT', 'APPROVED', 'PARTIAL', 'OVERDUE']

export const prismaDashboardRepository: DashboardRepository = {
  async getStats() {
    const now = new Date()

    const [
      invoiceAgg,
      billAgg,
      expenseAgg,
      payrollAgg,
      receivablesAgg,
      payablesAgg,
      counts,
      recentInvoices,
      recentBills,
      recentExpenses,
      recentJournal,
      recentPayroll,
      recentPayments,
      recentCustomers,
      recentVendors,
      recentEmployees,
      recentInventory,
      recentReceipts,
      invoiceByStatus,
      billByStatus,
      journalByStatus,
      expenseByStatus,
    ] = await Promise.all([
      prisma.invoice.aggregate({
        where: { status: { not: 'VOID' } },
        _sum: { total: true, subtotal: true, taxAmount: true, amountPaid: true },
        _count: true,
      }),
      prisma.bill.aggregate({
        where: { status: { not: 'VOID' } },
        _sum: { total: true, subtotal: true, amountPaid: true },
        _count: true,
      }),
      prisma.expense.aggregate({
        where: { status: { notIn: ['REJECTED'] } },
        _sum: { total: true },
        _count: true,
      }),
      prisma.payrollEntry.aggregate({
        _sum: { netSalary: true },
        _count: true,
      }),
      prisma.invoice.aggregate({
        where: { status: { in: OPEN_INVOICE_STATUSES }, balance: { gt: 0 } },
        _sum: { balance: true },
        _count: true,
      }),
      prisma.bill.aggregate({
        where: { status: { in: OPEN_BILL_STATUSES }, balance: { gt: 0 } },
        _sum: { balance: true },
        _count: true,
      }),
      Promise.all([
        prisma.customer.count({ where: { isActive: true } }),
        prisma.vendor.count({ where: { isActive: true } }),
        prisma.chartOfAccount.count({ where: { isActive: true, subType: { not: 'Header' } } }),
        prisma.journalEntry.count(),
        prisma.costCenter.count({ where: { isActive: true } }),
        prisma.employee.count({ where: { isActive: true } }),
        prisma.inventoryItem.count({ where: { isActive: true } }),
        prisma.receipt.count(),
        prisma.payment.count(),
        prisma.user.count({ where: { isActive: true } }),
      ]),
      prisma.invoice.findMany({
        take: 5,
        orderBy: { updatedAt: 'desc' },
        include: { customer: { select: { name: true } } },
      }),
      prisma.bill.findMany({
        take: 5,
        orderBy: { updatedAt: 'desc' },
        include: { vendor: { select: { name: true } } },
      }),
      prisma.expense.findMany({
        take: 5,
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          expenseNo: true,
          description: true,
          category: true,
          total: true,
          status: true,
          date: true,
          updatedAt: true,
        },
      }),
      prisma.journalEntry.findMany({
        take: 5,
        orderBy: { updatedAt: 'desc' },
        include: { createdBy: { select: { name: true } } },
      }),
      prisma.payrollEntry.findMany({
        take: 5,
        orderBy: { updatedAt: 'desc' },
        include: { employee: { select: { name: true } } },
      }),
      prisma.payment.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: {
          invoice: { select: { invoiceNo: true } },
          bill: { select: { billNo: true } },
        },
      }),
      prisma.customer.findMany({
        take: 3,
        orderBy: { createdAt: 'desc' },
        select: { id: true, customerNo: true, name: true, createdAt: true },
      }),
      prisma.vendor.findMany({
        take: 3,
        orderBy: { createdAt: 'desc' },
        select: { id: true, vendorNo: true, name: true, createdAt: true },
      }),
      prisma.employee.findMany({
        take: 3,
        orderBy: { createdAt: 'desc' },
        select: { id: true, employeeNo: true, name: true, department: true, createdAt: true },
      }),
      prisma.inventoryItem.findMany({
        take: 3,
        orderBy: { updatedAt: 'desc' },
        select: { id: true, itemCode: true, name: true, quantity: true, salePrice: true, updatedAt: true },
      }),
      prisma.receipt.findMany({
        take: 3,
        orderBy: { createdAt: 'desc' },
        select: { id: true, fileName: true, vendor: true, amount: true, status: true, createdAt: true },
      }),
      prisma.invoice.groupBy({ by: ['status'], _count: true, _sum: { total: true } }),
      prisma.bill.groupBy({ by: ['status'], _count: true, _sum: { total: true } }),
      prisma.journalEntry.groupBy({ by: ['status'], _count: true }),
      prisma.expense.groupBy({ by: ['status'], _count: true, _sum: { total: true } }),
    ])

    const monthlyData: { month: string; revenue: number; expenses: number; bills: number }[] = []
    for (let i = 5; i >= 0; i--) {
      const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59)
      const monthLabel = monthStart.toLocaleString('en', { month: 'short', year: '2-digit' })

      const [monthInv, monthExp, monthBills] = await Promise.all([
        prisma.invoice.aggregate({
          where: { date: { gte: monthStart, lte: monthEnd }, status: { not: 'VOID' } },
          _sum: { subtotal: true },
        }),
        prisma.expense.aggregate({
          where: { date: { gte: monthStart, lte: monthEnd }, status: { notIn: ['REJECTED'] } },
          _sum: { total: true },
        }),
        prisma.bill.aggregate({
          where: { date: { gte: monthStart, lte: monthEnd }, status: { not: 'VOID' } },
          _sum: { subtotal: true },
        }),
      ])

      monthlyData.push({
        month: monthLabel,
        revenue: monthInv._sum.subtotal ?? 0,
        expenses: monthExp._sum.total ?? 0,
        bills: monthBills._sum.subtotal ?? 0,
      })
    }

    const overdueInvoices = await prisma.invoice.findMany({
      where: { status: { in: OPEN_INVOICE_STATUSES }, balance: { gt: 0 } },
      select: { balance: true, dueDate: true },
    })

    const aging = { current: 0, days30: 0, days60: 0, days90plus: 0 }
    for (const inv of overdueInvoices) {
      const days = Math.floor((now.getTime() - inv.dueDate.getTime()) / (1000 * 60 * 60 * 24))
      if (days <= 0) aging.current += inv.balance
      else if (days <= 30) aging.days30 += inv.balance
      else if (days <= 60) aging.days60 += inv.balance
      else aging.days90plus += inv.balance
    }

    const totalRevenue = invoiceAgg._sum.subtotal ?? 0
    const totalExpenses =
      (expenseAgg._sum.total ?? 0) + (billAgg._sum.subtotal ?? 0) + (payrollAgg._sum.netSalary ?? 0)

    const activity = buildActivityFeed({
      recentInvoices,
      recentBills,
      recentExpenses,
      recentJournal,
      recentPayroll,
      recentPayments,
      recentCustomers,
      recentVendors,
      recentEmployees,
      recentInventory,
      recentReceipts,
    })

    const [
      customers,
      vendors,
      accounts,
      journalEntries,
      costCenters,
      employees,
      inventory,
      receipts,
      payments,
      users,
    ] = counts

    return {
      kpis: {
        totalRevenue,
        totalExpenses,
        totalInvoiced: invoiceAgg._sum.total ?? 0,
        totalBilled: billAgg._sum.total ?? 0,
        totalCollected: invoiceAgg._sum.amountPaid ?? 0,
        totalPaidOut: billAgg._sum.amountPaid ?? 0,
        payrollTotal: payrollAgg._sum.netSalary ?? 0,
        accountsReceivable: receivablesAgg._sum.balance ?? 0,
        accountsPayable: payablesAgg._sum.balance ?? 0,
        openInvoices: receivablesAgg._count,
        openBills: payablesAgg._count,
      },
      counts: {
        customers,
        vendors,
        accounts,
        journalEntries,
        costCenters,
        employees,
        inventory,
        receipts,
        payments,
        users,
        invoices: invoiceAgg._count,
        bills: billAgg._count,
        expenses: expenseAgg._count,
        payroll: payrollAgg._count,
      },
      monthlyData,
      aging,
      statusBreakdown: {
        invoices: invoiceByStatus,
        bills: billByStatus,
        journal: journalByStatus,
        expenses: expenseByStatus,
      },
      recentInvoices,
      recentBills,
      recentExpenses,
      recentJournal,
      recentPayroll,
      recentPayments,
      activity,
    } as DashboardPayload
  },
}
