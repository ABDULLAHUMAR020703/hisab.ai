import 'server-only'
import { prisma } from '@/lib/prisma'
import type { PayrollEntryRecord } from '../entities'
import type { PayrollListOptions, PayrollRepository } from './payroll.repository.interface'

export const prismaPayrollRepository: PayrollRepository = {
  async findMany(options: PayrollListOptions = {}) {
    const search = options.search ?? ''
    return prisma.payrollEntry.findMany({
      where: search
        ? {
            OR: [
              { payrollNo: { contains: search } },
              { period: { contains: search } },
              { employee: { name: { contains: search } } },
            ],
          }
        : {},
      include: {
        employee: { select: { name: true, employeeNo: true, department: true } },
        lines: true,
      },
      orderBy: { createdAt: 'desc' },
    }) as Promise<PayrollEntryRecord[]>
  },

  async findById(id: string) {
    return prisma.payrollEntry.findUnique({
      where: { id },
      include: { employee: true, lines: true },
    }) as Promise<PayrollEntryRecord | null>
  },
}
