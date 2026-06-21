import 'server-only'
import { prisma } from '@/lib/prisma'
import type { InventoryItemRecord } from '../entities'
import type { InventoryListOptions, InventoryRepository } from './inventory.repository.interface'

export const prismaInventoryRepository: InventoryRepository = {
  async findMany(options: InventoryListOptions = {}) {
    const search = options.search ?? ''
    return prisma.inventoryItem.findMany({
      where: search
        ? {
            OR: [
              { name: { contains: search } },
              { itemCode: { contains: search } },
              { category: { contains: search } },
            ],
          }
        : {},
      orderBy: { name: 'asc' },
    }) as Promise<InventoryItemRecord[]>
  },

  async findById(id: string) {
    return prisma.inventoryItem.findUnique({ where: { id } }) as Promise<InventoryItemRecord | null>
  },
}
