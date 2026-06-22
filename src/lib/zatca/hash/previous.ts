import { getPriorInvoiceHash } from '../persistence'

/**
 * Retrieves the hash of the most recent prior invoice that has been hashed.
 * Supports ZATCA invoice chain requirements (infrastructure only — no enforcement).
 */
export async function getPreviousInvoiceHash(invoiceId: string): Promise<string | null> {
  return getPriorInvoiceHash(invoiceId)
}
