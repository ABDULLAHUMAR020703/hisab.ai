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
 */
export function generateZatcaInvoiceXml(input: ZatcaInvoiceInput): ZatcaXmlGenerationResult {
  const inputValidation = validateZatcaInvoiceInput(input)
  const document = mapInvoiceToZatcaDocument(input)
  const documentValidation = validateZatcaDocument(document)
  const validation = mergeValidationResults(inputValidation, documentValidation)
  const xml = buildZatcaInvoiceXml(document)

  return { xml, document, validation }
}
