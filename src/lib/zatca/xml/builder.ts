import type {
  ZatcaAdditionalDocumentReference,
  ZatcaInvoiceDocument,
  ZatcaInvoiceLine,
  ZatcaParty,
  ZatcaTaxCategory,
  ZatcaTaxSubtotal,
} from '../types'
import { escapeXml } from './escape'
import { invoiceRootAttributes } from './namespaces'

function formatAmount(value: number): string {
  return value.toFixed(2)
}

function el(tag: string, content: string | number, attrs?: Record<string, string>): string {
  const attributeString = attrs
    ? ' ' + Object.entries(attrs).map(([k, v]) => `${k}="${escapeXml(v)}"`).join(' ')
    : ''
  return `<${tag}${attributeString}>${typeof content === 'number' ? formatAmount(content) : escapeXml(content)}</${tag}>`
}

function amountEl(tag: string, value: number, currency: string): string {
  return el(tag, formatAmount(value), { currencyID: currency })
}

function buildPartyIdentification(schemeId: string, id: string): string {
  return [
    '<cac:PartyIdentification>',
    el('cbc:ID', id, { schemeID: schemeId }),
    '</cac:PartyIdentification>',
  ].join('\n    ')
}

function buildPostalAddressBlock(party: ZatcaParty): string {
  const addr = party.postalAddress
  return [
    '<cac:PostalAddress>',
    el('cbc:StreetName', addr.streetName),
    el('cbc:BuildingNumber', addr.buildingNumber),
    el('cbc:CitySubdivisionName', addr.citySubdivisionName),
    el('cbc:CityName', addr.cityName),
    el('cbc:PostalZone', addr.postalZone),
    '<cac:Country>',
    el('cbc:IdentificationCode', addr.countryCode),
    '</cac:Country>',
    '</cac:PostalAddress>',
  ].join('\n      ')
}

function buildParty(party: ZatcaParty): string {
  const identifications = party.identifications
    .map((ident) => buildPartyIdentification(ident.schemeId, ident.id))
    .join('\n    ')

  const contact = [
    party.telephone ? el('cbc:Telephone', party.telephone) : '',
    party.email ? el('cbc:ElectronicMail', party.email) : '',
  ].filter(Boolean)

  const partyTaxScheme = party.vatNumber
    ? [
        '<cac:PartyTaxScheme>',
        el('cbc:CompanyID', party.vatNumber),
        '<cac:TaxScheme>',
        el('cbc:ID', 'VAT'),
        '</cac:TaxScheme>',
        '</cac:PartyTaxScheme>',
      ].join('\n      ')
    : ''

  return [
    '<cac:Party>',
    identifications,
    buildPostalAddressBlock(party),
    partyTaxScheme,
    '<cac:PartyLegalEntity>',
    el('cbc:RegistrationName', party.registrationName),
    '</cac:PartyLegalEntity>',
    contact.length ? '<cac:Contact>' + contact.join('\n      ') + '\n    </cac:Contact>' : '',
    '</cac:Party>',
  ]
    .filter(Boolean)
    .join('\n    ')
}

function buildTaxCategory(category: ZatcaTaxCategory): string {
  return [
    '<cac:TaxCategory>',
    el('cbc:ID', category.id, { schemeID: 'UN/ECE 5305', schemeAgencyID: '6' }),
    el('cbc:Percent', formatAmount(category.percent)),
    '<cac:TaxScheme>',
    el('cbc:ID', category.taxSchemeId, { schemeID: 'UN/ECE 5153', schemeAgencyID: '6' }),
    '</cac:TaxScheme>',
    '</cac:TaxCategory>',
  ].join('\n        ')
}

function buildTaxSubtotal(subtotal: ZatcaTaxSubtotal, currency: string): string {
  return [
    '<cac:TaxSubtotal>',
    amountEl('cbc:TaxableAmount', subtotal.taxableAmount, currency),
    amountEl('cbc:TaxAmount', subtotal.taxAmount, currency),
    buildTaxCategory(subtotal.category),
    '</cac:TaxSubtotal>',
  ].join('\n      ')
}

function buildAdditionalDocumentReference(ref: ZatcaAdditionalDocumentReference): string {
  if (ref.id === 'ICV') {
    return [
      '<cac:AdditionalDocumentReference>',
      el('cbc:ID', 'ICV'),
      el('cbc:UUID', ref.uuid ?? '1'),
      '</cac:AdditionalDocumentReference>',
    ].join('\n  ')
  }

  return [
    '<cac:AdditionalDocumentReference>',
    el('cbc:ID', ref.id),
    '<cac:Attachment>',
    el('cbc:EmbeddedDocumentBinaryObject', ref.embeddedContent ?? '', { mimeCode: 'text/plain' }),
    '</cac:Attachment>',
    '</cac:AdditionalDocumentReference>',
  ].join('\n  ')
}

function buildUblSignatureStub(): string {
  return [
    '<cac:Signature>',
    el('cbc:ID', 'urn:oasis:names:specification:ubl:signature:Invoice'),
    el('cbc:SignatureMethod', 'urn:oasis:names:specification:ubl:dsig:enveloped:xades'),
    '</cac:Signature>',
  ].join('\n  ')
}

function buildDeliveryBlock(issueDate: string): string {
  return [
    '<cac:Delivery>',
    el('cbc:ActualDeliveryDate', issueDate),
    '</cac:Delivery>',
  ].join('\n  ')
}

function buildBillingReference(invoiceNumber: string): string {
  return [
    '<cac:BillingReference>',
    '<cac:InvoiceDocumentReference>',
    el('cbc:ID', invoiceNumber),
    '</cac:InvoiceDocumentReference>',
    '</cac:BillingReference>',
  ].join('\n  ')
}

function buildPaymentMeans(document: ZatcaInvoiceDocument): string {
  const instructionNote = document.invoiceTypeCode === '381' || document.invoiceTypeCode === '383'
    ? el('cbc:InstructionNote', document.notes || 'Invoice adjustment')
    : ''

  return [
    '<cac:PaymentMeans>',
    el('cbc:PaymentMeansCode', '10'),
    instructionNote,
    '</cac:PaymentMeans>',
  ].filter(Boolean).join('\n  ')
}

function buildInvoiceLine(line: ZatcaInvoiceLine, currency: string): string {
  const lineInclusiveAmount = line.lineExtensionAmount + line.taxAmount

  return [
    '<cac:InvoiceLine>',
    el('cbc:ID', line.id),
    el('cbc:InvoicedQuantity', formatAmount(line.quantity), { unitCode: line.unitCode }),
    amountEl('cbc:LineExtensionAmount', line.lineExtensionAmount, currency),
    '<cac:TaxTotal>',
    amountEl('cbc:TaxAmount', line.taxAmount, currency),
    amountEl('cbc:RoundingAmount', lineInclusiveAmount, currency),
    '</cac:TaxTotal>',
    '<cac:Item>',
    el('cbc:Name', line.itemName),
    '<cac:ClassifiedTaxCategory>',
    el('cbc:ID', line.taxCategory.id, { schemeID: 'UN/ECE 5305', schemeAgencyID: '6' }),
    el('cbc:Percent', formatAmount(line.taxCategory.percent)),
    '<cac:TaxScheme>',
    el('cbc:ID', line.taxCategory.taxSchemeId, { schemeID: 'UN/ECE 5153', schemeAgencyID: '6' }),
    '</cac:TaxScheme>',
    '</cac:ClassifiedTaxCategory>',
    '</cac:Item>',
    '<cac:Price>',
    amountEl('cbc:PriceAmount', line.unitPrice, currency),
    '</cac:Price>',
    '</cac:InvoiceLine>',
  ].join('\n  ')
}

/**
 * Serializes a ZATCA-oriented UBL 2.1 document model to XML.
 * Includes ICV, PIH, optional QR reference, and UBL signature stub.
 * Cryptographic UBLExtensions are added during signing.
 */
export function buildZatcaInvoiceXml(document: ZatcaInvoiceDocument): string {
  const currency = document.documentCurrencyCode
  const taxSubtotals = document.taxTotal.subtotals
    .map((s) => buildTaxSubtotal(s, currency))
    .join('\n      ')

  const invoiceLines = document.invoiceLines
    .map((line) => buildInvoiceLine(line, currency))
    .join('\n  ')

  const additionalRefs = document.additionalDocumentReferences
    .map((ref) => buildAdditionalDocumentReference(ref))
    .join('\n  ')

  const monetary = document.legalMonetaryTotal

  const parts = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<Invoice ${invoiceRootAttributes()}>`,
    el('cbc:UBLVersionID', document.ublVersionId),
    el('cbc:ProfileID', document.profileId),
    el('cbc:ID', document.invoiceNumber),
    el('cbc:UUID', document.uuid),
    el('cbc:IssueDate', document.issueDate),
    el('cbc:IssueTime', document.issueTime),
    el('cbc:InvoiceTypeCode', document.invoiceTypeCode, { name: document.invoiceTypeCodeName }),
    document.notes ? el('cbc:Note', document.notes) : '',
    el('cbc:DocumentCurrencyCode', document.documentCurrencyCode),
    el('cbc:TaxCurrencyCode', document.taxCurrencyCode),
    document.billingReferenceId ? buildBillingReference(document.billingReferenceId) : '',
    additionalRefs,
    buildUblSignatureStub(),
    '<cac:AccountingSupplierParty>',
    buildParty(document.supplier),
    '</cac:AccountingSupplierParty>',
    '<cac:AccountingCustomerParty>',
    buildParty(document.customer),
    '</cac:AccountingCustomerParty>',
    document.invoiceTypeCodeName.startsWith('01') ? buildDeliveryBlock(document.issueDate) : '',
    buildPaymentMeans(document),
    '<cac:TaxTotal>',
    amountEl('cbc:TaxAmount', document.taxTotal.taxAmount, currency),
    '</cac:TaxTotal>',
    '<cac:TaxTotal>',
    amountEl('cbc:TaxAmount', document.taxTotal.taxAmount, currency),
    taxSubtotals,
    '</cac:TaxTotal>',
    '<cac:LegalMonetaryTotal>',
    amountEl('cbc:LineExtensionAmount', monetary.lineExtensionAmount, currency),
    amountEl('cbc:TaxExclusiveAmount', monetary.taxExclusiveAmount, currency),
    amountEl('cbc:TaxInclusiveAmount', monetary.taxInclusiveAmount, currency),
    amountEl('cbc:AllowanceTotalAmount', 0, currency),
    amountEl('cbc:PayableAmount', monetary.payableAmount, currency),
    '</cac:LegalMonetaryTotal>',
    invoiceLines,
    '</Invoice>',
  ]

  return parts.filter(Boolean).join('\n')
}
