import { createHash } from 'crypto'
import { canonicalizeInvoiceXml, stripSignatureBlock } from '../signature/canonicalize'

/**
 * Removes ZATCA-excluded nodes before invoice hash computation.
 * @see ZATCA Detailed Technical Guideline — hash generation step 1
 */
export function stripXmlForZatcaHash(xml: string): string {
  let result = stripSignatureBlock(xml)
  result = result.replace(
    /<cac:AdditionalDocumentReference>[\s\S]*?<cbc:ID>QR<\/cbc:ID>[\s\S]*?<\/cac:AdditionalDocumentReference>/g,
    '',
  )
  result = result.replace(/<cac:Signature>[\s\S]*?<\/cac:Signature>/g, '')
  return canonicalizeInvoiceXml(result)
}

/**
 * SHA-256 hash of ZATCA-canonicalized invoice XML (hex, lowercase).
 */
export function generateZatcaInvoiceHash(xml: string): string {
  const prepared = stripXmlForZatcaHash(xml)
  return createHash('sha256').update(prepared, 'utf8').digest('hex')
}

/** Converts a hex invoice hash to base64 PIH value for the next invoice. */
export function invoiceHashHexToPihBase64(hexHash: string): string {
  return Buffer.from(hexHash, 'hex').toString('base64')
}
