import { prisma } from '@/lib/prisma'

/**
 * Retrieves the hash of the most recent prior invoice that has been hashed.
 * Supports ZATCA invoice chain requirements (infrastructure only — no enforcement).
 */
export async function getPreviousInvoiceHash(invoiceId: string): Promise<string | null> {
  const current = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, createdAt: true },
  })

  if (!current) return null

  const previous = await prisma.invoice.findFirst({
    where: {
      id: { not: invoiceId },
      invoiceHash: { not: null },
      createdAt: { lt: current.createdAt },
    },
    orderBy: { createdAt: 'desc' },
    select: { invoiceHash: true },
  })

  return previous?.invoiceHash ?? null
}
