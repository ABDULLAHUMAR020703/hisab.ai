import type { ZatcaInvoiceInput } from './types'
import { isSimplifiedTaxInvoice } from './constants'
import {
  embedQrInInvoiceXml,
  generatePhase2QrPayload,
} from './qr/generator'
import { signInvoiceXmlDetailed } from './signature/signer'

export interface SignedInvoiceWithQrResult {
  signedXml: string
  invoiceHashHex: string
  qrPayload: string | null
}

function shouldEmbedQrInXml(input: ZatcaInvoiceInput): boolean {
  return isSimplifiedTaxInvoice(input)
}

const QR_PLACEHOLDER = 'UEFSQ0VIT0xERVI='

/**
 * Signs invoice XML and embeds Phase 2 QR (tags 1–9) for reporting invoice types.
 */
export function signAndEmbedPhase2Qr(
  unsignedXml: string,
  input: ZatcaInvoiceInput,
  certificatePem: string,
  privateKeyPem: string,
): SignedInvoiceWithQrResult {
  const xmlToSign = shouldEmbedQrInXml(input)
    ? embedQrInInvoiceXml(unsignedXml, QR_PLACEHOLDER)
    : unsignedXml

  const signResult = signInvoiceXmlDetailed(xmlToSign, certificatePem, privateKeyPem)

  if (!shouldEmbedQrInXml(input)) {
    return {
      signedXml: signResult.signedXml,
      invoiceHashHex: signResult.invoiceHashHex,
      qrPayload: null,
    }
  }

  const qr = generatePhase2QrPayload({
    invoice: input,
    signedXml: signResult.signedXml,
    certificatePem,
  })

  if (!qr.validation.valid || !qr.payload) {
    throw new Error(
      qr.validation.errors.map((e) => e.message).join('; ') || 'Phase 2 QR generation failed',
    )
  }

  return {
    signedXml: embedQrInInvoiceXml(signResult.signedXml, qr.payload),
    invoiceHashHex: signResult.invoiceHashHex,
    qrPayload: qr.payload,
  }
}
