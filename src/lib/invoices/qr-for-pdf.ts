import 'server-only'
import QRCode from 'qrcode'
import { generateZatcaInvoiceXml } from '@/lib/zatca/generate'
import { enrichZatcaInvoiceInput, loadZatcaInvoiceById } from '@/lib/zatca/invoice-service'
import { signAndEmbedPhase2Qr } from '@/lib/zatca/invoice-signing'
import { generatePhase2QrDataUrl, generateQrDataUrl } from '@/lib/zatca/qr/generator'
import { loadSigningCredentials } from '@/lib/zatca/signature/certificate'

export function extractQrPayloadFromSignedXml(signedXml: string): string | null {
  const match = signedXml.match(
    /<cac:AdditionalDocumentReference>[\s\S]*?<cbc:ID>QR<\/cbc:ID>[\s\S]*?<cbc:EmbeddedDocumentBinaryObject[^>]*>([^<]+)<\/cbc:EmbeddedDocumentBinaryObject>/,
  )
  return match?.[1]?.trim() ?? null
}

async function tlvPayloadToPngBuffer(payload: string): Promise<Buffer> {
  const dataUrl = await QRCode.toDataURL(payload, {
    errorCorrectionLevel: 'M',
    type: 'image/png',
    margin: 1,
    width: 280,
  })
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, '')
  return Buffer.from(base64, 'base64')
}

export interface InvoiceQrForPdf {
  png: Buffer
  phase: 1 | 2
  caption: string
}

function isSubmittedZatcaStatus(status: string): boolean {
  const normalized = status.toUpperCase()
  return normalized === 'CLEARED' || normalized === 'REPORTED' || normalized === 'SUBMITTED'
}

async function qrFromStoredXml(xml: string): Promise<InvoiceQrForPdf | null> {
  const embedded = extractQrPayloadFromSignedXml(xml)
  if (!embedded) return null
  return {
    png: await tlvPayloadToPngBuffer(embedded),
    phase: 2,
    caption: 'ZATCA E-Invoice QR',
  }
}

/**
 * Resolves the best available ZATCA QR image for a printable invoice PDF.
 * Submitted invoices use only stored cleared/signed XML — never regenerated.
 */
export async function resolveInvoiceQrForPdf(invoiceId: string): Promise<InvoiceQrForPdf | null> {
  const loaded = await loadZatcaInvoiceById(invoiceId)
  if (!loaded || !loaded.companySettings.zatcaEnabled) {
    return null
  }

  const { invoice, input, companySettings } = loaded
  const zatcaStatus = (invoice.zatcaStatus ?? 'DRAFT').toUpperCase()

  if (isSubmittedZatcaStatus(zatcaStatus)) {
    if (zatcaStatus === 'CLEARED' && invoice.clearedInvoicePayload) {
      try {
        const clearedXml = Buffer.from(invoice.clearedInvoicePayload, 'base64').toString('utf8')
        const fromCleared = await qrFromStoredXml(clearedXml)
        if (fromCleared) return fromCleared
      } catch {
        // Fall through to signed XML.
      }
    }

    if (invoice.signedXml) {
      const fromSigned = await qrFromStoredXml(invoice.signedXml)
      if (fromSigned) return fromSigned
    }

    return null
  }

  const needsPhase2Qr =
    input.invoiceType === 'SIMPLIFIED'
    || input.invoiceType === 'CREDIT_NOTE'
    || input.invoiceType === 'DEBIT_NOTE'

  if (needsPhase2Qr) {
    try {
      const creds = await loadSigningCredentials(companySettings.zatcaEnvironment)
      const enriched = await enrichZatcaInvoiceInput(input, invoiceId)
      const xmlResult = generateZatcaInvoiceXml(enriched)
      if (xmlResult.validation.valid) {
        const signed = signAndEmbedPhase2Qr(
          xmlResult.xml,
          enriched,
          creds.certificatePem,
          creds.privateKeyPem,
        )
        if (signed.qrPayload) {
          return {
            png: await tlvPayloadToPngBuffer(signed.qrPayload),
            phase: 2,
            caption: 'ZATCA E-Invoice QR (preview)',
          }
        }
      }
    } catch {
      // Credentials or signing unavailable — use Phase 1 preview QR.
    }
  }

  const phase1 = await generateQrDataUrl(input)
  if (!phase1.validation.valid || !phase1.qrDataUrl) {
    return null
  }

  const base64 = phase1.qrDataUrl.replace(/^data:image\/png;base64,/, '')
  return {
    png: Buffer.from(base64, 'base64'),
    phase: 1,
    caption: needsPhase2Qr
      ? 'ZATCA QR (preview — submit invoice for Phase 2 stamp)'
      : 'ZATCA E-Invoice QR (preview)',
  }
}
