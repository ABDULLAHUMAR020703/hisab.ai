import 'server-only'
import { prisma } from '@/lib/prisma'
import type { CompanySettingsRecord, CompanySettingsUpdateInput } from '../types'
import type { SettingsRepository } from './settings.interface'

function mapRow(row: Awaited<ReturnType<typeof prisma.companySettings.findFirst>>): CompanySettingsRecord | null {
  if (!row) return null
  return { ...row }
}

export const prismaSettingsRepository: SettingsRepository = {
  async findFirst() {
    return mapRow(await prisma.companySettings.findFirst())
  },

  async create(input) {
    const row = await prisma.companySettings.create({ data: input })
    return { ...row }
  },

  async update(companyId, input) {
    const row = await prisma.companySettings.update({
      where: { id: companyId },
      data: input,
    })
    return { ...row }
  },

  async upsert(input) {
    const existing = await prisma.companySettings.findFirst()
    if (!existing) {
      return prismaSettingsRepository.create({
        companyName: input.companyName ?? 'NETKOM COMPANY FOR COMMUNICATION',
        ...input,
      })
    }
    return prismaSettingsRepository.update(existing.id, input)
  },
}
