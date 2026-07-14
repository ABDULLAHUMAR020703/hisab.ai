import 'server-only'
import { prisma } from '@/lib/prisma'
import { ageBucket } from './aging-utils'

export async function buildAgedReceivablesReport(asOf: Date) {
  const invoices = await prisma.invoice.findMany({
    where: {
      balance: { gt: 0 },
      status: { in: ['SENT', 'PAID', 'PARTIAL'] },
    },
    include: { customer: { select: { id: true, name: true } } },
    orderBy: { dueDate: 'asc' },
  })

  const buckets: Record<string, { total: number; count: number }> = {
    current: { total: 0, count: 0 },
    '1-30': { total: 0, count: 0 },
    '31-60': { total: 0, count: 0 },
    '61-90': { total: 0, count: 0 },
    '90+': { total: 0, count: 0 },
  }

  const details = invoices.map((inv: {
    id: string; invoiceNo: string; date: Date; dueDate: Date; total: number; balance: number
    customer: { id: string; name: string } | null
  }) => {
    const daysPastDue = Math.floor((asOf.getTime() - new Date(inv.dueDate).getTime()) / (1000 * 60 * 60 * 24))
    const bucket = ageBucket(daysPastDue)
    buckets[bucket].total += inv.balance
    buckets[bucket].count += 1
    return {
      id: inv.id,
      invoiceNo: inv.invoiceNo,
      customer: inv.customer,
      customerName: inv.customer?.name ?? '',
      date: inv.date,
      dueDate: inv.dueDate,
      total: inv.total,
      balance: inv.balance,
      amount: inv.balance,
      daysPastDue,
      bucket,
    }
  })

  const grandTotal = details.reduce((s: number, d: { balance: number }) => s + d.balance, 0)

  return {
    asOf: asOf.toISOString(),
    type: 'AGED_AR',
    buckets,
    grandTotal,
    details,
  }
}

export async function buildAgedPayablesReport(asOf: Date) {
  const bills = await prisma.bill.findMany({
    where: {
      balance: { gt: 0 },
      status: { in: ['RECEIVED', 'PAID', 'PARTIAL'] },
    },
    include: { vendor: { select: { id: true, name: true } } },
    orderBy: { dueDate: 'asc' },
  })

  const buckets: Record<string, { total: number; count: number }> = {
    current: { total: 0, count: 0 },
    '1-30': { total: 0, count: 0 },
    '31-60': { total: 0, count: 0 },
    '61-90': { total: 0, count: 0 },
    '90+': { total: 0, count: 0 },
  }

  const details = bills.map((bill: {
    id: string; billNo: string; date: Date; dueDate: Date; total: number; balance: number
    vendor: { id: string; name: string } | null
  }) => {
    const daysPastDue = Math.floor((asOf.getTime() - new Date(bill.dueDate).getTime()) / (1000 * 60 * 60 * 24))
    const bucket = ageBucket(daysPastDue)
    buckets[bucket].total += bill.balance
    buckets[bucket].count += 1
    return {
      id: bill.id,
      billNo: bill.billNo,
      vendor: bill.vendor,
      vendorName: bill.vendor?.name ?? '',
      date: bill.date,
      dueDate: bill.dueDate,
      total: bill.total,
      balance: bill.balance,
      amount: bill.balance,
      daysPastDue,
      bucket,
    }
  })

  const grandTotal = details.reduce((s: number, d: { balance: number }) => s + d.balance, 0)

  return {
    asOf: asOf.toISOString(),
    type: 'AGED_AP',
    buckets,
    grandTotal,
    grandTotalPayable: grandTotal,
    details,
  }
}
