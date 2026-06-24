import 'server-only'
import { createHash, X509Certificate } from 'crypto'

export interface ZatcaCertificateInfo {
  /** Base64-encoded SHA-256 digest of the certificate body (ZATCA CertDigest). */
  hash: string
  issuer: string
  subject: string
  serialNumber: string
  fingerprint256: string
  /** DER-encoded SubjectPublicKeyInfo public key bytes (QR tag 8 source). */
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
 * ZATCA certificate hash: SHA-256(cert base64 body as UTF-8) → hex → base64(hex string).
 * @see ZATCA security features implementation standards §1.6.2.1.1.2
 */
export function getCertificateHash(certBodyBase64: string): string {
  const hexDigest = createHash('sha256').update(certBodyBase64, 'utf8').digest('hex')
  return Buffer.from(hexDigest, 'utf8').toString('base64')
}

function parseWithNodeCrypto(certificatePem: string, bodyBase64: string): ZatcaCertificateInfo | null {
  try {
    const x509 = new X509Certificate(certificatePem)
    const der = Buffer.from(bodyBase64, 'base64')
    const publicKey = extractSubjectPublicKeyBytes(x509)
    const certificateSignature = extractCertificateSignatureBytes(der)

    return {
      hash: getCertificateHash(bodyBase64),
      issuer: x509.issuer.split('\n').reverse().join(', '),
      subject: x509.subject.split('\n').reverse().join(', '),
      serialNumber: BigInt(`0x${x509.serialNumber}`).toString(10),
      fingerprint256: x509.fingerprint256,
      publicKey,
      certificateSignature,
      bodyBase64,
    }
  } catch {
    return null
  }
}

interface DerNode {
  tag: number
  valueStart: number
  valueEnd: number
  nextOffset: number
}

function readDerNode(buffer: Buffer, offset = 0): DerNode {
  if (offset >= buffer.length) throw new Error('DER offset out of range')
  const tag = buffer[offset]
  let cursor = offset + 1
  const lengthByte = buffer[cursor++]
  let length = lengthByte

  if (lengthByte & 0x80) {
    const lengthBytes = lengthByte & 0x7f
    if (lengthBytes === 0 || lengthBytes > 4) throw new Error('Unsupported DER length')
    length = 0
    for (let i = 0; i < lengthBytes; i += 1) {
      length = (length << 8) | buffer[cursor++]
    }
  }

  const valueStart = cursor
  const valueEnd = valueStart + length
  if (valueEnd > buffer.length) throw new Error('DER length exceeds buffer')
  return { tag, valueStart, valueEnd, nextOffset: valueEnd }
}

function readSequenceChildren(sequence: DerNode, buffer: Buffer): DerNode[] {
  if (sequence.tag !== 0x30) throw new Error('Expected DER sequence')
  const children: DerNode[] = []
  let cursor = sequence.valueStart
  while (cursor < sequence.valueEnd) {
    const child = readDerNode(buffer, cursor)
    children.push(child)
    cursor = child.nextOffset
  }
  return children
}

function bitStringValue(buffer: Buffer, node: DerNode): Buffer {
  if (node.tag !== 0x03) throw new Error('Expected DER bit string')
  const unusedBits = buffer[node.valueStart]
  if (unusedBits !== 0) throw new Error('Unsupported DER bit string padding')
  return buffer.subarray(node.valueStart + 1, node.valueEnd)
}

function extractSubjectPublicKeyBytes(x509: X509Certificate): Buffer {
  return x509.publicKey.export({ format: 'der', type: 'spki' }) as Buffer
}

function extractCertificateSignatureBytes(certificateDer: Buffer): Buffer {
  const certificate = readDerNode(certificateDer)
  const children = readSequenceChildren(certificate, certificateDer)
  const signatureBitString = children[2]
  if (!signatureBitString) throw new Error('Certificate signature bit string not found')
  return bitStringValue(certificateDer, signatureBitString)
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
