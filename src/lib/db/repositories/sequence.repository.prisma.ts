import 'server-only'
import { prisma } from '@/lib/prisma'
import type { SequenceRepository } from './sequence.repository.interface'

export const prismaSequenceRepository: SequenceRepository = {
  async next(type: string, prefix: string) {
    let seq = await prisma.sequence.findUnique({ where: { type } })
    if (!seq) {
      seq = await prisma.sequence.create({ data: { type, prefix, nextNo: 1 } })
    }

    const no = seq.nextNo
    await prisma.sequence.update({ where: { type }, data: { nextNo: no + 1 } })
    return `${prefix}${String(no).padStart(5, '0')}`
  },
}
