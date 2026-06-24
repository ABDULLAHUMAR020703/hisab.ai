import 'server-only'
import { loadInvoicePdfDocument } from './load-document'
import { renderSaudiProfessionalInvoice } from './templates/saudi-professional'
import type { InvoicePdfDocument } from './types'

const defaultTemplate = {
  id: 'saudi-professional',
  render: renderSaudiProfessionalInvoice,
}

export async function generateInvoicePdf(
  invoiceId: string,
): Promise<{ pdf: Buffer; filename: string }> {
  const document = await loadInvoicePdfDocument(invoiceId)
  if (!document) {
    throw new Error('Invoice not found')
  }
  const pdf = await defaultTemplate.render(document)
  const filename = `${document.invoiceNo.replace(/[^\w.-]+/g, '_')}.pdf`
  return { pdf, filename }
}

/** Renders a pre-built document — useful for tests or alternate entry points. */
export async function renderInvoicePdfDocument(
  document: InvoicePdfDocument,
  templateId = defaultTemplate.id,
): Promise<Buffer> {
  if (templateId !== defaultTemplate.id) {
    throw new Error(`Unknown invoice PDF template: ${templateId}`)
  }
  return defaultTemplate.render(document)
}

export { loadInvoicePdfDocument } from './load-document'
export type { InvoicePdfDocument } from './types'
