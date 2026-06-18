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

/**
 * Resolves the best available ZATCA QR image for a printable invoice PDF.
 */
export async function resolveInvoiceQrForPdf(invoiceId: string): Promise<InvoiceQrForPdf | null> {
  const loaded = await loadZatcaInvoiceById(invoiceId)
  if (!loaded || !loaded.companySettings.zatcaEnabled) {
    return null
  }

  const { invoice, input, companySettings } = loaded

  if (invoice.signedXml) {
    const embedded = extractQrPayloadFromSignedXml(invoice.signedXml)
    if (embedded) {
      return {
        png: await tlvPayloadToPngBuffer(embedded),
        phase: 2,
        caption: 'ZATCA E-Invoice QR (Phase 2)',
      }
    }

    try {
      const creds = await loadSigningCredentials(companySettings.zatcaEnvironment)
      const phase2 = await generatePhase2QrDataUrl({
        invoice: input,
        signedXml: invoice.signedXml,
        certificatePem: creds.certificatePem,
      })
      if (phase2.validation.valid && phase2.qrDataUrl) {
        const base64 = phase2.qrDataUrl.replace(/^data:image\/png;base64,/, '')
        return {
          png: Buffer.from(base64, 'base64'),
          phase: 2,
          caption: 'ZATCA E-Invoice QR (Phase 2)',
        }
      }
    } catch {
      // Fall through to Phase 1 or ephemeral signing.
    }
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
            caption: 'ZATCA E-Invoice QR (Phase 2)',
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
      : 'ZATCA E-Invoice QR',
  }
}
