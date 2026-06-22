import { countHashedInvoices } from '../persistence'

/**
 * Returns the next monotonic invoice counter value (ICV) for ZATCA XML.
 * Based on count of invoices that have been hashed/submitted in this tenant.
 */
export async function getNextInvoiceCounterValue(excludeInvoiceId?: string): Promise<number> {
  const count = await countHashedInvoices(excludeInvoiceId)
  return count + 1
}
