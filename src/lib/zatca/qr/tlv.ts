/**
 * ZATCA Phase 2 QR TLV encoding (Tags 1–9).
 * @see ZATCA e-invoicing security features implementation standards
 */

export interface TlvFields {
  /** Tag 1 — Seller name */
  sellerName: string
  /** Tag 2 — VAT registration number */
  vatNumber: string
  /** Tag 3 — Timestamp (ISO 8601) */
  timestamp: string
  /** Tag 4 — Invoice total (including VAT) */
  invoiceTotal: string
  /** Tag 5 — VAT total */
  vatTotal: string
}

export interface Phase2TlvFields extends TlvFields {
  /** Tag 6 — Base64 invoice hash (DigestValue from signed XML) */
  invoiceHashBase64: string
  /** Tag 7 — Base64 ECDSA digital signature (SignatureValue) */
  digitalSignature: string
  /** Tag 8 — Raw ECDSA public key bytes */
  publicKey: Buffer
  /** Tag 9 — CA signature on public key (simplified invoices only) */
  certificateSignature?: Buffer
}

const TLV_TAGS = {
  SELLER_NAME: 1,
  VAT_NUMBER: 2,
  TIMESTAMP: 3,
  INVOICE_TOTAL: 4,
  VAT_TOTAL: 5,
  INVOICE_HASH: 6,
  DIGITAL_SIGNATURE: 7,
  PUBLIC_KEY: 8,
  CERTIFICATE_SIGNATURE: 9,
} as const

function encodeTlvStringField(tag: number, value: string): Buffer {
  const valueBytes = Buffer.from(value, 'utf8')
  if (valueBytes.length > 255) {
    throw new Error(`TLV value for tag ${tag} exceeds 255 bytes`)
  }
  return Buffer.concat([Buffer.from([tag, valueBytes.length]), valueBytes])
}

function encodeTlvBinaryField(tag: number, value: Buffer): Buffer {
  if (value.length > 255) {
    throw new Error(`TLV binary value for tag ${tag} exceeds 255 bytes`)
  }
  return Buffer.concat([Buffer.from([tag, value.length]), value])
}

/**
 * Encodes ZATCA Phase 1 QR fields (tags 1–5) as Base64 TLV.
 */
export function generateTlvPayload(fields: TlvFields): string {
  const tlv = Buffer.concat([
    encodeTlvStringField(TLV_TAGS.SELLER_NAME, fields.sellerName),
    encodeTlvStringField(TLV_TAGS.VAT_NUMBER, fields.vatNumber),
    encodeTlvStringField(TLV_TAGS.TIMESTAMP, fields.timestamp),
    encodeTlvStringField(TLV_TAGS.INVOICE_TOTAL, fields.invoiceTotal),
    encodeTlvStringField(TLV_TAGS.VAT_TOTAL, fields.vatTotal),
  ])

  return tlv.toString('base64')
}

/**
 * Encodes full Phase 2 QR TLV (tags 1–9) as Base64.
 * Tag 9 is included only when certificateSignature is provided (simplified/reporting types).
 */
export function generatePhase2TlvPayload(fields: Phase2TlvFields): string {
  const parts: Buffer[] = [
    encodeTlvStringField(TLV_TAGS.SELLER_NAME, fields.sellerName),
    encodeTlvStringField(TLV_TAGS.VAT_NUMBER, fields.vatNumber),
    encodeTlvStringField(TLV_TAGS.TIMESTAMP, fields.timestamp),
    encodeTlvStringField(TLV_TAGS.INVOICE_TOTAL, fields.invoiceTotal),
    encodeTlvStringField(TLV_TAGS.VAT_TOTAL, fields.vatTotal),
    encodeTlvStringField(TLV_TAGS.INVOICE_HASH, fields.invoiceHashBase64),
    encodeTlvStringField(TLV_TAGS.DIGITAL_SIGNATURE, fields.digitalSignature),
    encodeTlvBinaryField(TLV_TAGS.PUBLIC_KEY, fields.publicKey),
  ]

  if (fields.certificateSignature) {
    parts.push(encodeTlvBinaryField(TLV_TAGS.CERTIFICATE_SIGNATURE, fields.certificateSignature))
  }

  return Buffer.concat(parts).toString('base64')
}
