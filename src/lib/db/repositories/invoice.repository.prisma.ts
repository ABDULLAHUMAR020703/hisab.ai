import 'server-only'
import { prisma } from '@/lib/prisma'
import type { InvoiceRecord } from '../entities'
import type { InvoiceListOptions, InvoiceRepository } from './invoice.repository.interface'

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
}
