import { roundMoney } from '@/lib/tax/calculator'
import type { ZatcaInvoiceDocument, ZatcaInvoiceInput, ZatcaValidationIssue, ZatcaValidationResult } from '../types'

function error(code: string, field: string, message: string): ZatcaValidationIssue {
  return { code, field, message, severity: 'error' }
}

/**
 * Validates monetary integrity of the **processed** UBL document only.
 * Does not recalculate VAT from raw rates — uses mapper/XML pipeline totals.
 */
export function validateProcessedMonetaryTotals(
  document: ZatcaInvoiceDocument,
): ZatcaValidationResult {
  const errors: ZatcaValidationIssue[] = []
  const monetary = document.legalMonetaryTotal
  const taxExclusive = roundMoney(monetary.taxExclusiveAmount)
  const taxAmount = roundMoney(document.taxTotal.taxAmount)
  const taxInclusive = roundMoney(monetary.taxInclusiveAmount)
  const payable = roundMoney(monetary.payableAmount)
  const lineExtension = roundMoney(monetary.lineExtensionAmount)

  if (taxExclusive <= 0) {
    errors.push(error(
      'INV_SUBTOTAL_REQUIRED',
      'legalMonetaryTotal.taxExclusiveAmount',
      'Invoice subtotal must be greater than zero',
    ))
  }

  if (taxAmount < 0) {
    errors.push(error(
      'INV_VAT_INVALID',
      'taxTotal.taxAmount',
      'Invoice VAT amount is invalid',
    ))
  }

  if (taxInclusive <= 0) {
    errors.push(error(
      'INV_TOTAL_REQUIRED',
      'legalMonetaryTotal.taxInclusiveAmount',
      'Invoice total must be greater than zero',
    ))
  }

  const expectedInclusive = roundMoney(taxExclusive + taxAmount)
  if (Math.abs(expectedInclusive - taxInclusive) > 0.001) {
    errors.push(error(
      'INV_TOTAL_MISMATCH',
      'legalMonetaryTotal.taxInclusiveAmount',
      'Invoice total does not match line amounts plus VAT',
    ))
  }

  if (Math.abs(taxInclusive - payable) > 0.001) {
    errors.push(error(
      'INV_PAYABLE_MISMATCH',
      'legalMonetaryTotal.payableAmount',
      'Payable amount must equal tax inclusive amount',
    ))
  }

  if (Math.abs(lineExtension - taxExclusive) > 0.001) {
    errors.push(error(
      'INV_LINE_EXTENSION_MISMATCH',
      'legalMonetaryTotal.lineExtensionAmount',
      'Line extension amount must equal tax exclusive amount',
    ))
  }

  const lineExtSum = roundMoney(
    document.invoiceLines.reduce((s, l) => s + l.lineExtensionAmount, 0),
  )
  const lineTaxSum = roundMoney(
    document.invoiceLines.reduce((s, l) => s + l.taxAmount, 0),
  )
  const subtotalTaxSum = roundMoney(
    document.taxTotal.subtotals.reduce((s, t) => s + t.taxAmount, 0),
  )

  if (Math.abs(lineExtSum - taxExclusive) > 0.001) {
    errors.push(error(
      'INV_LINE_SUM_MISMATCH',
      'invoiceLines',
      'Sum of line extension amounts does not match tax exclusive amount',
    ))
  }

  if (Math.abs(lineTaxSum - taxAmount) > 0.001) {
    errors.push(error(
      'INV_LINE_TAX_SUM_MISMATCH',
      'invoiceLines.taxAmount',
      'Sum of line VAT amounts does not match document tax total',
    ))
  }

  if (Math.abs(subtotalTaxSum - taxAmount) > 0.001) {
    errors.push(error(
      'INV_TAX_SUBTOTAL_MISMATCH',
      'taxTotal.subtotals',
      'TaxSubtotal amounts do not match document TaxTotal',
    ))
  }

  return { valid: errors.length === 0, errors, warnings: [] }
}

/** Non-monetary invoice field checks (UUID, currency). Issue time is validated on the mapped document. */
export function validateInvoiceIdentityFields(input: ZatcaInvoiceInput): ZatcaValidationResult {
  const errors: ZatcaValidationIssue[] = []

  if (!input.currency?.trim()) {
    errors.push(error('INV_CURRENCY_REQUIRED', 'invoice.currency', 'Invoice currency is required'))
  } else if (input.currency !== 'SAR') {
    errors.push(error('INV_CURRENCY_SAR', 'invoice.currency', 'Invoice currency must be SAR for ZATCA submission'))
  }

  return { valid: errors.length === 0, errors, warnings: [] }
}

/** Extract monetary snapshot for logging / assertions. */
export function extractDocumentMonetarySnapshot(document: ZatcaInvoiceDocument) {
  return {
    lineExtensionAmount: roundMoney(document.legalMonetaryTotal.lineExtensionAmount),
    taxExclusiveAmount: roundMoney(document.legalMonetaryTotal.taxExclusiveAmount),
    taxAmount: roundMoney(document.taxTotal.taxAmount),
    taxInclusiveAmount: roundMoney(document.legalMonetaryTotal.taxInclusiveAmount),
    payableAmount: roundMoney(document.legalMonetaryTotal.payableAmount),
    profileId: document.profileId,
    invoiceTypeCode: document.invoiceTypeCode,
    invoiceTypeCodeName: document.invoiceTypeCodeName,
  }
}

/** Parse key monetary fields from XML for integrity checks. */
export function extractXmlMonetarySnapshot(xml: string) {
  const pick = (tag: string): number | null => {
    const re = new RegExp(`<cbc:${tag}[^>]*>([\\d.]+)</cbc:${tag}>`)
    const match = xml.match(re)
    return match ? roundMoney(Number(match[1])) : null
  }
  return {
    lineExtensionAmount: pick('LineExtensionAmount'),
    taxExclusiveAmount: pick('TaxExclusiveAmount'),
    // First TaxAmount under TaxTotal (document level appears before line TaxAmounts in our builder)
    taxAmount: (() => {
      const match = xml.match(
        /<cac:TaxTotal>\s*<cbc:TaxAmount[^>]*>([\d.]+)<\/cbc:TaxAmount>/,
      )
      return match ? roundMoney(Number(match[1])) : null
    })(),
    taxInclusiveAmount: pick('TaxInclusiveAmount'),
    payableAmount: pick('PayableAmount'),
    profileId: xml.match(/<cbc:ProfileID>([^<]+)<\/cbc:ProfileID>/)?.[1] ?? null,
  }
}
