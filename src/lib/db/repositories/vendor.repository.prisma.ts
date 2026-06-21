import 'server-only'
import { prisma } from '@/lib/prisma'
import type { VendorRecord } from '../entities'
import { resolveSequenceRepository } from '../sequence-resolver'
import type {
  VendorCreateInput,
  VendorListOptions,
  VendorRepository,
  VendorUpdateInput,
} from './vendor.repository.interface'

const OPEN_STATUSES = ['RECEIVED', 'PARTIAL', 'OVERDUE']

function withOutstandingBalance(
  vendor: VendorRecord & { bills?: { balance: number; status: string }[] },
): VendorRecord {
  const outstandingBalance = (vendor.bills ?? [])
    .filter((b) => OPEN_STATUSES.includes(b.status))
    .reduce((s, b) => s + b.balance, 0)
  const { bills, ...rest } = vendor
  return { ...rest, outstandingBalance }
}

export const prismaVendorRepository: VendorRepository = {
  async findMany(options: VendorListOptions = {}) {
    const search = options.search ?? ''
    const vendors = await prisma.vendor.findMany({
      where: search
        ? {
            OR: [
              { name: { contains: search } },
              { email: { contains: search } },
              { vendorNo: { contains: search } },
            ],
          }
        : {},
      include: { bills: { select: { balance: true, status: true } } },
      orderBy: { name: 'asc' },
    })
    return vendors.map((v) => withOutstandingBalance(v as VendorRecord))
  },

  async findById(id: string) {
    return prisma.vendor.findUnique({
      where: { id },
      include: { bills: { orderBy: { date: 'desc' }, take: 10 } },
    }) as Promise<VendorRecord | null>
  },

  async create(input: VendorCreateInput) {
    const vendorNo = await resolveSequenceRepository().next('VENDOR', 'VEND-')
    const vendor = await prisma.vendor.create({
      data: {
        vendorNo,
        name: input.name,
        email: input.email ?? null,
        phone: input.phone ?? null,
        address: input.address ?? null,
        city: input.city ?? null,
        country: input.country ?? null,
        taxId: input.taxId ?? null,
        paymentTerms: input.paymentTerms ?? 30,
      },
    })
    return vendor as VendorRecord
  },

  async update(id: string, input: VendorUpdateInput) {
    const vendor = await prisma.vendor.update({
      where: { id },
      data: {
        name: input.name,
        email: input.email,
        phone: input.phone,
        address: input.address,
        city: input.city,
        country: input.country,
        taxId: input.taxId,
        paymentTerms: input.paymentTerms,
        isActive: input.isActive,
      },
    })
    return vendor as VendorRecord
  },

  async delete(id: string) {
    await prisma.vendor.delete({ where: { id } })
  },
}
