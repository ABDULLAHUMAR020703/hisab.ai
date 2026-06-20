import type { ZatcaEnvironment } from '@prisma/client'

/**
 * DER hex encodings of every OID/marker a valid ZATCA CSR must contain.
 * We scan the raw DER instead of using a high-level parser because node-forge
 * cannot read secp256k1 public keys (it throws "Unknown OID"), so a structural
 * byte-level check is the most reliable preflight.
 */
const OID_HEX = {
  countryName: '0603550406', // 2.5.4.6
  organizationalUnitName: '060355040b', // 2.5.4.11
  organizationName: '060355040a', // 2.5.4.10
  commonName: '0603550403', // 2.5.4.3
  certificateTemplateName: '06092b0601040182371402', // 1.3.6.1.4.1.311.20.2
  subjectAltName: '0603551d11', // 2.5.29.17
  // ZATCA's `SN=` maps to surname (2.5.4.4); the gateway rejects serialNumber (2.5.4.5).
  surname: '0603550404', // 2.5.4.4  (SN field)
  uid: '060a0992268993f22c640101', // 0.9.2342.19200300.100.1.1 (UID)
  title: '060355040c', // 2.5.4.12
  registeredAddress: '060355041a', // 2.5.4.26
  businessCategory: '060355040f', // 2.5.4.15
  ecdsaWithSha256: '06082a8648ce3d040302', // 1.2.840.10045.4.3.2
  secp256k1: '06052b8104000a', // 1.3.132.0.10
} as const

export interface CsrVerificationField {
  name: string
  present: boolean
  critical: boolean
}

export interface CsrVerificationResult {
  ok: boolean
  fields: CsrVerificationField[]
  missingCritical: string[]
  summary: string
}

export interface CsrVerificationExpectation {
  environment: ZatcaEnvironment
  vat: string
  commonName: string
}

function pemToDerHex(csrPem: string): string {
  const b64 = csrPem
    .replace(/-----BEGIN CERTIFICATE REQUEST-----/g, '')
    .replace(/-----END CERTIFICATE REQUEST-----/g, '')
    .replace(/\s+/g, '')
  return Buffer.from(b64, 'base64').toString('hex').toLowerCase()
}

function asciiHex(value: string): string {
  return Buffer.from(value, 'ascii').toString('hex').toLowerCase()
}

/**
 * Verifies a generated CSR contains every field ZATCA requires, in the exact
 * encoding the gateway expects. Returns a structured report (no exceptions) so
 * callers can log proof and decide whether to proceed.
 */
export function verifyZatcaCsr(
  csrPem: string,
  expected: CsrVerificationExpectation,
): CsrVerificationResult {
  const hex = pemToDerHex(csrPem)

  const templateValue = expected.environment === 'PRODUCTION'
    ? 'ZATCA-Code-Signing'
    : 'PREZATCA-Code-Signing'
  const templateHex = asciiHex(templateValue)
  const vat = expected.vat.replace(/\D/g, '')
  const vatHex = asciiHex(vat)
  const cnHex = asciiHex(expected.commonName)

  const fields: CsrVerificationField[] = [
    { name: 'Country (C=SA)', critical: true, present: hex.includes(OID_HEX.countryName) },
    { name: 'Organization (O)', critical: true, present: hex.includes(OID_HEX.organizationName) },
    { name: 'Organizational Unit (OU)', critical: false, present: hex.includes(OID_HEX.organizationalUnitName) },
    {
      name: `Common Name (CN=${expected.commonName})`,
      critical: true,
      present: hex.includes(OID_HEX.commonName) && hex.includes(cnHex),
    },
    {
      name: 'certificateTemplateName OID (1.3.6.1.4.1.311.20.2)',
      critical: true,
      present: hex.includes(OID_HEX.certificateTemplateName),
    },
    {
      name: `template value (${templateValue}, PRINTABLESTRING)`,
      critical: true,
      present: hex.includes(`13${(templateValue.length).toString(16).padStart(2, '0')}${templateHex}`),
    },
    { name: 'subjectAltName extension (2.5.29.17)', critical: true, present: hex.includes(OID_HEX.subjectAltName) },
    { name: 'EGS serial (SN = surname 2.5.4.4)', critical: true, present: hex.includes(OID_HEX.surname) },
    {
      name: `VAT in SAN UID (${vat})`,
      critical: true,
      present: hex.includes(OID_HEX.uid) && hex.includes(vatHex),
    },
    { name: 'Invoice type (title)', critical: true, present: hex.includes(OID_HEX.title) },
    { name: 'Registered address', critical: true, present: hex.includes(OID_HEX.registeredAddress) },
    { name: 'Business category', critical: true, present: hex.includes(OID_HEX.businessCategory) },
    { name: 'Signature ECDSA-with-SHA256', critical: true, present: hex.includes(OID_HEX.ecdsaWithSha256) },
    { name: 'Key curve secp256k1', critical: true, present: hex.includes(OID_HEX.secp256k1) },
  ]

  const missingCritical = fields.filter((f) => f.critical && !f.present).map((f) => f.name)
  const ok = missingCritical.length === 0
  const summary = fields.map((f) => `${f.present ? '[OK]' : '[!!]'} ${f.name}`).join('\n')

  return { ok, fields, missingCritical, summary }
}
