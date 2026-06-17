import { generateZatcaInvoiceHash } from './zatca-hash'

/**
 * SHA-256 hash of ZATCA-canonicalized UBL XML for invoice chaining and API submission.
 * Returns a 64-character lowercase hexadecimal string.
 */
export function generateInvoiceHash(xml: string): string {
  return generateZatcaInvoiceHash(xml)
}
