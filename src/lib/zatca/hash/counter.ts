import { prisma } from '@/lib/prisma'

/**
 * Returns the next monotonic invoice counter value (ICV) for ZATCA XML.
 * Based on count of invoices that have been hashed/submitted in this tenant.
 */
export async function getNextInvoiceCounterValue(excludeInvoiceId?: string): Promise<number> {
  const count = await prisma.invoice.count({
    where: {
      invoiceHash: { not: null },
      ...(excludeInvoiceId ? { id: { not: excludeInvoiceId } } : {}),
    },
  })
  return count + 1
}
