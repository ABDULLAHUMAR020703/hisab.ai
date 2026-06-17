/**
 * XML canonicalization for ZATCA signing.
 * Simplified C14N-style normalization — modular hook for future full C14N upgrade.
 */
export function canonicalizeInvoiceXml(xml: string): string {
  return xml
    .replace(/\r\n/g, '\n')
    .replace(/>\s+</g, '><')
    .trim()
}

export function stripSignatureBlock(xml: string): string {
  return xml.replace(/<ext:UBLExtensions>[\s\S]*?<\/ext:UBLExtensions>/g, '').trim()
}
