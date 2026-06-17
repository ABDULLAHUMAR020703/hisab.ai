/** UBL 2.1 XML namespace declarations for ZATCA-oriented invoices */
export const UBL_NAMESPACES = {
  invoice: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
  cac: 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
  cbc: 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
  ext: 'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2',
} as const

export function invoiceRootAttributes(): string {
  const { invoice, cac, cbc, ext } = UBL_NAMESPACES
  return [
    `xmlns="${invoice}"`,
    `xmlns:cac="${cac}"`,
    `xmlns:cbc="${cbc}"`,
    `xmlns:ext="${ext}"`,
  ].join('\n  ')
}
