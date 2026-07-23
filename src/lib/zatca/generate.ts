import { mapInvoiceToZatcaDocument } from './mapper'
import type { ZatcaInvoiceInput, ZatcaXmlGenerationResult } from './types'
import { buildZatcaInvoiceXml } from './xml/builder'
import {
  mergeValidationResults,
  validateZatcaDocument,
  validateZatcaInvoiceInput,
} from './xml/validator'

/**
 * Full Day 2 pipeline: validate input → map to UBL model → validate document → build XML.
 * Document monetary totals are line-derived; returned `document` is the source of truth for BT-112.
 */
export function generateZatcaInvoiceXml(input: ZatcaInvoiceInput): ZatcaXmlGenerationResult {
  const inputValidation = validateZatcaInvoiceInput(input)
  const document = mapInvoiceToZatcaDocument(input)
  const documentValidation = validateZatcaDocument(document)
  const validation = mergeValidationResults(inputValidation, documentValidation)
  const xml = buildZatcaInvoiceXml(document)

  return { xml, document, validation }
}

/** Align invoice input totals with mapped document (for QR / persistence). */
export function syncInputTotalsFromDocument(
  input: ZatcaInvoiceInput,
  document: ReturnType<typeof mapInvoiceToZatcaDocument>,
): ZatcaInvoiceInput {
  return {
    ...input,
    subtotal: document.legalMonetaryTotal.taxExclusiveAmount,
    taxAmount: document.taxTotal.taxAmount,
    total: document.legalMonetaryTotal.taxInclusiveAmount,
  }
}
