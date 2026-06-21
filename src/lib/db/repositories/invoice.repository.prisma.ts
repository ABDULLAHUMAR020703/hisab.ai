import 'server-only'
import { randomUUID } from 'crypto'
import { prisma } from '@/lib/prisma'
import type { InvoiceRecord } from '../entities'
import { resolveSequenceRepository } from '../sequence-resolver'
import type {
  InvoiceCreateInput,
  InvoiceLineInput,
  InvoiceListOptions,
  InvoiceRepository,
  InvoiceUpdateInput,
} from './invoice.repository.interface'

function formatIssueTime(date: Date): string {
  return date.toTimeString().split(' ')[0]
}

function processLines(lines: InvoiceLineInput[]) {
  let subtotal = 0
  let taxAmount = 0
  const processedLines = lines.map((line) => {
    const quantity = Number(line.quantity)
    const unitPrice = Number(line.unitPrice)
    const taxRate = Number(line.taxRate)
    const amount = quantity * unitPrice
    subtotal += amount
    taxAmount += amount * (taxRate / 100)
    return {
      description: line.description,
      quantity,
      unitPrice,
      taxRate,
      amount,
      accountId: line.accountId || null,
      costCenterId: line.costCenterId || null,
    }
  })
  return { processedLines, subtotal, taxAmount, total: subtotal + taxAmount }
}

export const prismaInvoiceRepository: InvoiceRepository = {
  async findMany(options: InvoiceListOptions = {}) {
    const search = options.search ?? ''
    const status = options.status ?? ''
    return prisma.invoice.findMany({
      where: {
        AND: [
          search
            ? {
                OR: [
                  { invoiceNo: { contains: search } },
                  { customer: { name: { contains: search } } },
                ],
              }
            : {},
          status ? { status } : {},
        ],
      },
      include: { customer: { select: { name: true, email: true } }, lines: true },
      orderBy: { date: 'desc' },
    }) as Promise<InvoiceRecord[]>
  },

  async findById(id: string) {
    return prisma.invoice.findUnique({
      where: { id },
      include: {
        customer: true,
        lines: { include: { account: true } },
        payments: true,
        createdBy: { select: { name: true } },
      },
    }) as Promise<InvoiceRecord | null>
  },

  async create(input: InvoiceCreateInput) {
    const { processedLines, subtotal, taxAmount, total } = processLines(input.lines)
    const issueDate = new Date(input.date)
    const invoiceNo = await resolveSequenceRepository().next('INVOICE', 'INV-')

    return prisma.invoice.create({
      data: {
        invoiceNo,
        invoiceUUID: randomUUID(),
        customerId: input.customerId,
        date: issueDate,
        issueTime: formatIssueTime(issueDate),
        dueDate: new Date(input.dueDate),
        subtotal,
        taxAmount,
        total,
        balance: total,
        notes: input.notes ?? null,
        terms: input.terms ?? null,
        isRecurring: input.isRecurring ?? false,
        recurringDay: input.recurringDay ?? null,
        createdById: input.createdById,
        lines: { create: processedLines },
      },
      include: { customer: { select: { name: true } }, lines: true },
    }) as Promise<InvoiceRecord>
  },

  async update(id: string, input: InvoiceUpdateInput) {
    const existing = await prisma.invoice.findUnique({ where: { id } })
    if (!existing) throw new Error('Invoice not found')
    if (existing.status === 'PAID') throw new Error('Cannot edit paid invoice')

    const data: Record<string, unknown> = {
      customerId: input.customerId,
      date: input.date !== undefined ? new Date(input.date) : undefined,
      dueDate: input.dueDate !== undefined ? new Date(input.dueDate) : undefined,
      notes: input.notes,
      terms: input.terms,
      status: input.status ?? existing.status,
    }

    if (input.lines !== undefined) {
      const { processedLines, subtotal, taxAmount, total } = processLines(input.lines)
      data.subtotal = subtotal
      data.taxAmount = taxAmount
      data.total = total
      data.balance = total - existing.amountPaid
      await prisma.invoiceLine.deleteMany({ where: { invoiceId: id } })
      data.lines = { create: processedLines }
    }

    return prisma.invoice.update({
      where: { id },
      data,
      include: { customer: { select: { name: true } }, lines: true },
    }) as Promise<InvoiceRecord>
  },

  async delete(id: string) {
    const invoice = await prisma.invoice.findUnique({ where: { id } })
    if (!invoice) throw new Error('Invoice not found')
    if (invoice.status === 'PAID') throw new Error('Cannot delete paid invoice')
    await prisma.invoice.delete({ where: { id } })
  },
}
