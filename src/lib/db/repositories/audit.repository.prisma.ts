import 'server-only'
import { prisma } from '@/lib/prisma'
import type { ZatcaAuditLogRecord } from '../entities'
import type { AuditRepository } from './audit.repository.interface'

export const prismaAuditRepository: AuditRepository = {
  async findRecent(limit = 50) {
    return prisma.zatcaAuditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    }) as Promise<ZatcaAuditLogRecord[]>
  },
}
