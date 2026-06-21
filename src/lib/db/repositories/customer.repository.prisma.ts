import 'server-only'
import { prisma } from '@/lib/prisma'
import { mapCustomerRow } from '../entity-mappers'
import type { CustomerRecord } from '../entities'
import { resolveSequenceRepository } from '../sequence-resolver'
import type {
  CustomerCreateInput,
  CustomerListOptions,
  CustomerRepository,
  CustomerUpdateInput,
} from './customer.repository.interface'

const OPEN_STATUSES = ['SENT', 'PARTIAL', 'OVERDUE']

function withOutstandingBalance(
  customer: CustomerRecord & { invoices?: { balance: number; status: string }[] },
): CustomerRecord {
  const outstandingBalance = (customer.invoices ?? [])
    .filter((i) => OPEN_STATUSES.includes(i.status))
    .reduce((s, i) => s + i.balance, 0)
  const { invoices, ...rest } = customer
  return { ...rest, outstandingBalance }
}

function mapPrismaCustomer(row: Awaited<ReturnType<typeof prisma.customer.findUnique>>): CustomerRecord {
  return row as CustomerRecord
}

export const prismaCustomerRepository: CustomerRepository = {
  async findMany(options: CustomerListOptions = {}) {
    const search = options.search ?? ''
    const customers = await prisma.customer.findMany({
      where: search
        ? {
            OR: [
              { name: { contains: search } },
              { email: { contains: search } },
              { customerNo: { contains: search } },
            ],
          }
        : {},
      include: { invoices: { select: { balance: true, status: true } } },
      orderBy: { name: 'asc' },
    })
    return customers.map((c) => withOutstandingBalance(c as CustomerRecord))
  },

  async findById(id: string) {
    const customer = await prisma.customer.findUnique({
      where: { id },
      include: { invoices: { orderBy: { date: 'desc' }, take: 10 } },
    })
    return customer as CustomerRecord | null
  },

  async create(input: CustomerCreateInput) {
    const customerNo = await resolveSequenceRepository().next('CUSTOMER', 'CUST-')
    const customer = await prisma.customer.create({
      data: {
        customerNo,
        name: input.name,
        email: input.email ?? null,
        phone: input.phone ?? null,
        address: input.address ?? null,
        city: input.city ?? null,
        country: input.country ?? null,
        taxId: input.taxId ?? null,
        creditLimit: input.creditLimit ?? 0,
        paymentTerms: input.paymentTerms ?? 30,
      },
    })
    return mapPrismaCustomer(customer)
  },

  async update(id: string, input: CustomerUpdateInput) {
    const customer = await prisma.customer.update({
      where: { id },
      data: {
        name: input.name,
        email: input.email,
        phone: input.phone,
        address: input.address,
        city: input.city,
        country: input.country,
        taxId: input.taxId,
        creditLimit: input.creditLimit,
        paymentTerms: input.paymentTerms,
        isActive: input.isActive,
      },
    })
    return mapPrismaCustomer(customer)
  },

  async delete(id: string) {
    await prisma.customer.delete({ where: { id } })
  },
}
