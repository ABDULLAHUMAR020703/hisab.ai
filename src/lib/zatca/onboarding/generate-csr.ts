import 'server-only'
import { createSign, generateKeyPairSync } from 'crypto'
import forge from 'node-forge'
import type { ZatcaCsrResult, ZatcaCsrSubjectInput } from './types'
import { buildCsrSubjectValues, csrPemToBase64, csrPemToZatcaBase64 } from './csr-subject'
import { generateZatcaCsrWithOpenSsl, isOpenSslAvailable } from './openssl-csr'

const OID = {
  extensionRequest: '1.2.840.113549.1.9.14',
  subjectAltName: '2.5.29.17',
  certificateTemplateName: '1.3.6.1.4.1.311.20.2',
  basicConstraints: '2.5.29.19',
  keyUsage: '2.5.29.15',
  ecdsaWithSha256: '1.2.840.10045.4.3.2',
  countryName: '2.5.4.6',
  organizationalUnitName: '2.5.4.11',
  organizationName: '2.5.4.10',
  commonName: '2.5.4.3',
  // ZATCA's documented CSR config uses `SN=...`, which OpenSSL maps to surname
  // (2.5.4.4) — and the ZATCA gateway only accepts that OID, not serialNumber.
  surname: '2.5.4.4',
  uid: '0.9.2342.19200300.100.1.1',
  title: '2.5.4.12',
  registeredAddress: '2.5.4.26',
  businessCategory: '2.5.4.15',
  organizationIdentifier: '2.5.4.97',
} as const

type RdnAttribute = { type: string; value: string }

function oidBytes(oid: string): string {
  return forge.asn1.oidToDer(oid).getBytes()
}

function printableString(value: string): forge.asn1.Asn1 {
  return forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.PRINTABLESTRING, false, value)
}

/**
 * ZATCA accepts CSRs whose subject/SAN attribute values are UTF8String — this is
 * what the OpenSSL CSRs the gateway accepts use. PRINTABLESTRING values are
 * rejected, so the forge fallback must encode these as UTF8String to match.
 */
function utf8String(value: string): forge.asn1.Asn1 {
  return forge.asn1.create(
    forge.asn1.Class.UNIVERSAL,
    forge.asn1.Type.UTF8,
    false,
    forge.util.encodeUtf8(value),
  )
}

function rdnSequence(attributes: RdnAttribute[]): forge.asn1.Asn1 {
  const children: forge.asn1.Asn1[] = []

  for (const attribute of attributes) {
    children.push(
      forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, [
        forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
          forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.OID, false, oidBytes(attribute.type)),
          utf8String(attribute.value),
        ]),
      ]),
    )
  }

  return forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, children)
}

function certificateTemplateValue(environment: ZatcaCsrSubjectInput['environment']): string {
  return environment === 'SANDBOX' ? 'PREZATCA-Code-Signing' : 'ZATCA-Code-Signing'
}

function buildExtension(
  oid: string,
  value: forge.asn1.Asn1 | string,
): forge.asn1.Asn1 {
  const extnValueBytes = typeof value === 'string'
    ? value
    : forge.asn1.toDer(value).getBytes()

  return forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
    forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.OID, false, oidBytes(oid)),
    forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.OCTETSTRING, false, extnValueBytes),
  ])
}

function buildZatcaExtensionRequestAttributes(
  input: ZatcaCsrSubjectInput,
  subject: ReturnType<typeof buildCsrSubjectValues>,
): forge.asn1.Asn1 {
  const certificateTemplateExtension = buildExtension(
    OID.certificateTemplateName,
    printableString(certificateTemplateValue(input.environment)),
  )

  const directoryName = rdnSequence([
    {
      type: OID.surname,
      value: `1-${subject.solutionName}|2-${subject.egsModel}|3-${subject.egsSerialNumber}`,
    },
    { type: OID.uid, value: subject.vat },
    { type: OID.title, value: subject.invoiceTypes },
    { type: OID.registeredAddress, value: subject.registeredAddress },
    { type: OID.businessCategory, value: subject.businessCategory },
  ])

  const subjectAltName = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
    forge.asn1.create(forge.asn1.Class.CONTEXT_SPECIFIC, 4, true, [directoryName]),
  ])

  const subjectAltNameExtension = buildExtension(OID.subjectAltName, subjectAltName)

  const extensions = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
    certificateTemplateExtension,
    subjectAltNameExtension,
  ])

  return forge.asn1.create(forge.asn1.Class.CONTEXT_SPECIFIC, 0, true, [
    forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
      forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.OID, false, oidBytes(OID.extensionRequest)),
      forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, [extensions]),
    ]),
  ])
}

function buildCertificationRequestInfo(
  subject: RdnAttribute[],
  subjectPublicKeyInfoDer: Buffer,
  attributes: forge.asn1.Asn1,
): forge.asn1.Asn1 {
  return forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
    forge.asn1.create(
      forge.asn1.Class.UNIVERSAL,
      forge.asn1.Type.INTEGER,
      false,
      forge.asn1.integerToDer(0).getBytes(),
    ),
    rdnSequence(subject),
    forge.asn1.fromDer(subjectPublicKeyInfoDer.toString('binary')),
    attributes,
  ])
}

function buildCertificationRequest(
  certificationRequestInfo: forge.asn1.Asn1,
  signature: Buffer,
): forge.asn1.Asn1 {
  return forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
    certificationRequestInfo,
    forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
      forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.OID, false, oidBytes(OID.ecdsaWithSha256)),
    ]),
    forge.asn1.create(
      forge.asn1.Class.UNIVERSAL,
      forge.asn1.Type.BITSTRING,
      false,
      String.fromCharCode(0x00) + signature.toString('binary'),
    ),
  ])
}

function certificationRequestToPem(csr: forge.asn1.Asn1): string {
  return forge.pem.encode({
    type: 'CERTIFICATE REQUEST',
    body: forge.asn1.toDer(csr).getBytes(),
  })
}

function generateZatcaCsrManual(input: ZatcaCsrSubjectInput): ZatcaCsrResult {
  const subject = buildCsrSubjectValues(input)

  const { privateKey, publicKey } = generateKeyPairSync('ec', {
    namedCurve: 'secp256k1',
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })

  const privateKeyPem = privateKey.toString()
  const publicKeyDer = Buffer.isBuffer(publicKey) ? publicKey : Buffer.from(publicKey)

  const dn: RdnAttribute[] = [
    { type: OID.countryName, value: 'SA' },
    { type: OID.organizationalUnitName, value: subject.organizationUnit },
    { type: OID.organizationName, value: subject.organizationName },
    { type: OID.commonName, value: subject.commonName },
  ]

  const attributes = buildZatcaExtensionRequestAttributes(input, subject)
  const certificationRequestInfo = buildCertificationRequestInfo(dn, publicKeyDer, attributes)
  const certificationRequestInfoDer = Buffer.from(
    forge.asn1.toDer(certificationRequestInfo).getBytes(),
    'binary',
  )

  const signer = createSign('SHA256')
  signer.update(certificationRequestInfoDer)
  signer.end()
  const signature = signer.sign(privateKeyPem)

  const csrPem = certificationRequestToPem(
    buildCertificationRequest(certificationRequestInfo, signature),
  )

  return {
    csrPem,
    csrBase64: csrPemToZatcaBase64(csrPem),
    privateKeyPem,
    commonName: subject.commonName,
  }
}

/**
 * Generates an ECDSA secp256k1 CSR aligned with ZATCA Fatoora onboarding requirements.
 * Uses OpenSSL when available; otherwise falls back to a pure Node.js ASN.1 builder.
 */
export async function generateZatcaCsr(input: ZatcaCsrSubjectInput): Promise<ZatcaCsrResult> {
  if (await isOpenSslAvailable()) {
    try {
      return await generateZatcaCsrWithOpenSsl(input)
    } catch {
      // Fall back when OpenSSL exists but CSR generation fails (e.g. bad config path on Windows).
    }
  }

  return generateZatcaCsrManual(input)
}

export { csrPemToBase64, csrPemToZatcaBase64 } from './csr-subject'
