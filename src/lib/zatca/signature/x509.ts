import 'server-only'
import { createHash, X509Certificate } from 'crypto'
import forge from 'node-forge'

export interface ZatcaCertificateInfo {
  /** Base64-encoded SHA-256 digest of the certificate body (ZATCA CertDigest). */
  hash: string
  issuer: string
  serialNumber: string
  /** Raw ECDSA public key bytes (SubjectPublicKeyInfo BIT STRING). */
  publicKey: Buffer
  /** ECDSA signature bytes from the certificate (Tag 9 source). */
  certificateSignature: Buffer
  /** Base64 DER body without PEM headers. */
  bodyBase64: string
}

export function cleanCertificateBody(certificatePem: string): string {
  return certificatePem
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s+/g, '')
}

/**
 * ZATCA certificate hash: SHA-256(cert base64 body) → hex → base64(hex string).
 * @see ZATCA security features implementation standards §1.6.2.1.1.2
 */
export function getCertificateHash(certBodyBase64: string): string {
  const hexDigest = createHash('sha256').update(certBodyBase64, 'utf8').digest('hex')
  return Buffer.from(hexDigest, 'utf8').toString('base64')
}

function parseWithNodeCrypto(certificatePem: string, bodyBase64: string): ZatcaCertificateInfo | null {
  try {
    const x509 = new X509Certificate(certificatePem)
    const forgeCert = forge.pki.certificateFromAsn1(
      forge.asn1.fromDer(Buffer.from(bodyBase64, 'base64').toString('binary')),
    )

    const publicKey = extractPublicKeyBytes(forgeCert)
    const certificateSignature = Buffer.from(forgeCert.signature, 'binary')

    return {
      hash: getCertificateHash(bodyBase64),
      issuer: x509.issuer.split('\n').reverse().join(', '),
      serialNumber: BigInt(`0x${x509.serialNumber}`).toString(10),
      publicKey,
      certificateSignature,
      bodyBase64,
    }
  } catch {
    return null
  }
}

type ForgeEcPublicKey = forge.pki.PublicKey & {
  publicKey?: forge.Bytes
  q?: forge.Bytes
}

function extractPublicKeyBytes(cert: forge.pki.Certificate): Buffer {
  const spki = cert.publicKey as ForgeEcPublicKey

  if (spki.publicKey) {
    return Buffer.from(spki.publicKey, 'binary')
  }

  if (spki.q) {
    return Buffer.from(spki.q, 'binary')
  }

  const asn1 = forge.pki.publicKeyToAsn1(cert.publicKey)
  const der = Buffer.from(forge.asn1.toDer(asn1).getBytes(), 'binary')
  return der
}

/**
 * Parses a ZATCA CSID PEM certificate for signing metadata and QR tags 8–9.
 */
export function parseZatcaCertificate(certificatePem: string): ZatcaCertificateInfo {
  const bodyBase64 = cleanCertificateBody(certificatePem)
  const wrapped = `-----BEGIN CERTIFICATE-----\n${bodyBase64}\n-----END CERTIFICATE-----`

  const parsed = parseWithNodeCrypto(wrapped, bodyBase64)
  if (parsed) return parsed

  throw new Error('Unable to parse ZATCA signing certificate')
}
