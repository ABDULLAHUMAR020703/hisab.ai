import type { ZatcaInvoiceInput } from './types'
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

function shouldEmbedQrInXml(invoiceType: ZatcaInvoiceInput['invoiceType']): boolean {
  return invoiceType === 'SIMPLIFIED' || invoiceType === 'CREDIT_NOTE' || invoiceType === 'DEBIT_NOTE'
}

/**
 * Signs invoice XML and embeds Phase 2 QR (tags 1–9) for reporting invoice types.
 */
export function signAndEmbedPhase2Qr(
  unsignedXml: string,
  input: ZatcaInvoiceInput,
  certificatePem: string,
  privateKeyPem: string,
): SignedInvoiceWithQrResult {
  const signResult = signInvoiceXmlDetailed(unsignedXml, certificatePem, privateKeyPem)

  if (!shouldEmbedQrInXml(input.invoiceType)) {
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
