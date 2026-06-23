import QRCode from 'qrcode'
import type { InvoiceType } from '@/lib/db/prisma-types'
import type { ZatcaCompanySettingsInput, ZatcaInvoiceInput } from '../types'
import { getCertificateHash, parseZatcaCertificate } from '../signature/x509'
import { extractSignatureValuesFromXml } from '../signature/signer'
import { generatePhase2TlvPayload, generateTlvPayload } from './tlv'
import { validatePhase2QrPayloadInput, validateQrPayloadInput } from './validator'

export interface QrGenerationResult {
  payload: string
  qrDataUrl: string
  validation: ReturnType<typeof validateQrPayloadInput>
}

function formatAmount(value: number): string {
  return value.toFixed(2)
}

/** Builds ZATCA ISO 8601 timestamp from invoice date and issue time. */
export function formatZatcaTimestamp(date: Date, issueTime?: string | null): string {
  const datePart = date.toISOString().slice(0, 10)
  const timePart = issueTime?.trim() || date.toTimeString().split(' ')[0]
  return `${datePart}T${timePart}`
}

function resolveSellerName(settings: ZatcaCompanySettingsInput): string {
  return (settings.legalName || settings.companyName).trim()
}

function buildQrFields(input: ZatcaInvoiceInput) {
  return {
    sellerName: resolveSellerName(input.companySettings),
    vatNumber: input.companySettings.taxId?.trim() ?? '',
    timestamp: formatZatcaTimestamp(input.date, input.issueTime),
    invoiceTotal: formatAmount(input.total),
    vatTotal: formatAmount(input.taxAmount),
  }
}

function requiresCertificateSignatureTag(invoiceType: InvoiceType): boolean {
  return invoiceType === 'SIMPLIFIED' || invoiceType === 'CREDIT_NOTE' || invoiceType === 'DEBIT_NOTE'
}

/**
 * Generates Base64 TLV QR payload for an invoice (Phase 1 tags 1–5 only).
 */
export function generateQrPayload(input: ZatcaInvoiceInput): {
  payload: string
  validation: QrGenerationResult['validation']
} {
  const fields = buildQrFields(input)
  const validation = validateQrPayloadInput({
    sellerName: fields.sellerName,
    vatNumber: fields.vatNumber,
    timestamp: fields.timestamp,
    invoiceTotal: input.total,
    vatTotal: input.taxAmount,
  })

  if (!validation.valid) {
    return { payload: '', validation }
  }

  const payload = generateTlvPayload(fields)
  return { payload, validation }
}

export interface Phase2QrInput {
  invoice: ZatcaInvoiceInput
  signedXml: string
  certificatePem: string
}

/**
 * Generates Phase 2 QR TLV (tags 1–9) from a signed invoice XML.
 */
export function generatePhase2QrPayload(input: Phase2QrInput): {
  payload: string
  validation: ReturnType<typeof validatePhase2QrPayloadInput>
} {
  const fields = buildQrFields(input.invoice)
  const signatureValues = extractSignatureValuesFromXml(input.signedXml)
  let certInfo: ReturnType<typeof parseZatcaCertificate>
  try {
    certInfo = parseZatcaCertificate(input.certificatePem)
  } catch {
    if (process.env.ZATCA_MOCK_SUBMISSION === 'true' || process.env.ZATCA_MOCK_ONBOARDING === 'true') {
      const bodyBase64 = input.certificatePem.replace(/-----BEGIN CERTIFICATE-----/g, '').replace(/-----END CERTIFICATE-----/g, '').replace(/\s+/g, '')
      certInfo = {
        hash: getCertificateHash(bodyBase64),
        issuer: 'CN=Mock',
        serialNumber: '1',
        publicKey: Buffer.alloc(48, 0xab),
        certificateSignature: Buffer.alloc(64, 0xcd),
        bodyBase64,
      }
    } else {
      throw new Error('Unable to parse certificate for Phase 2 QR generation')
    }
  }

  const validation = validatePhase2QrPayloadInput({
    sellerName: fields.sellerName,
    vatNumber: fields.vatNumber,
    timestamp: fields.timestamp,
    invoiceTotal: input.invoice.total,
    vatTotal: input.invoice.taxAmount,
    invoiceHashBase64: signatureValues.invoiceHashBase64,
    digitalSignature: signatureValues.digitalSignature,
    publicKey: certInfo.publicKey,
    certificateSignature: requiresCertificateSignatureTag(input.invoice.invoiceType)
      ? certInfo.certificateSignature
      : undefined,
  })

  if (!validation.valid) {
    return { payload: '', validation }
  }

  const payload = generatePhase2TlvPayload({
    ...fields,
    invoiceHashBase64: signatureValues.invoiceHashBase64!,
    digitalSignature: signatureValues.digitalSignature!,
    publicKey: certInfo.publicKey,
    certificateSignature: requiresCertificateSignatureTag(input.invoice.invoiceType)
      ? certInfo.certificateSignature
      : undefined,
  })

  return { payload, validation }
}

/**
 * Embeds or replaces the QR AdditionalDocumentReference in invoice XML.
 */
export function embedQrInInvoiceXml(xml: string, qrPayloadBase64: string): string {
  const qrBlock = [
    '<cac:AdditionalDocumentReference>',
    '<cbc:ID>QR</cbc:ID>',
    '<cac:Attachment>',
    `<cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${qrPayloadBase64}</cbc:EmbeddedDocumentBinaryObject>`,
    '</cac:Attachment>',
    '</cac:AdditionalDocumentReference>',
  ].join('\n  ')

  if (xml.includes('<cbc:ID>QR</cbc:ID>')) {
    return xml.replace(
      /<cac:AdditionalDocumentReference>[\s\S]*?<cbc:ID>QR<\/cbc:ID>[\s\S]*?<\/cac:AdditionalDocumentReference>/,
      qrBlock,
    )
  }

  return xml.replace(
    /(<cbc:TaxCurrencyCode>[^<]+<\/cbc:TaxCurrencyCode>)/,
    `$1\n  ${qrBlock}`,
  )
}

/**
 * Generates Base64 TLV payload and a PNG data URL QR code image (Phase 1).
 */
export async function generateQrDataUrl(input: ZatcaInvoiceInput): Promise<QrGenerationResult> {
  const { payload, validation } = generateQrPayload(input)

  if (!validation.valid) {
    return { payload: '', qrDataUrl: '', validation }
  }

  const qrDataUrl = await QRCode.toDataURL(payload, {
    errorCorrectionLevel: 'M',
    type: 'image/png',
    margin: 1,
    width: 256,
  })

  return { payload, qrDataUrl, validation }
}

/**
 * Generates Phase 2 QR PNG data URL from a signed invoice.
 */
export async function generatePhase2QrDataUrl(
  input: Phase2QrInput,
): Promise<QrGenerationResult> {
  const { payload, validation } = generatePhase2QrPayload(input)

  if (!validation.valid) {
    return { payload: '', qrDataUrl: '', validation }
  }

  const qrDataUrl = await QRCode.toDataURL(payload, {
    errorCorrectionLevel: 'M',
    type: 'image/png',
    margin: 1,
    width: 256,
  })

  return { payload, qrDataUrl, validation }
}
