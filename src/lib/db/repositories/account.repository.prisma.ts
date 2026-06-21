import 'server-only'
import { prisma } from '@/lib/prisma'
import type { ChartOfAccountRecord } from '../entities'
import type { AccountListOptions, AccountRepository } from './account.repository.interface'

export const prismaAccountRepository: AccountRepository = {
  async findMany(options: AccountListOptions = {}) {
    const search = options.search ?? ''
    const type = options.type ?? ''
    return prisma.chartOfAccount.findMany({
      where: {
        AND: [
          search
            ? {
                OR: [
                  { name: { contains: search } },
                  { accountNo: { contains: search } },
                  { fullName: { contains: search } },
                ],
              }
            : {},
          type ? { accountType: type } : {},
        ],
      },
      orderBy: { accountNo: 'asc' },
    }) as Promise<ChartOfAccountRecord[]>
  },

  async findById(id: string) {
    return prisma.chartOfAccount.findUnique({ where: { id } }) as Promise<ChartOfAccountRecord | null>
  },
}
