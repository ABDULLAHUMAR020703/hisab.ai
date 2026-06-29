import 'server-only'
import { createHash, createPrivateKey, createSign, createVerify } from 'crypto'
import forge from 'node-forge'
import { generateZatcaInvoiceHash } from '../hash/zatca-hash'
import { isMockSubmissionEnabled } from '../env-guard'
import { stripSignatureBlock } from './canonicalize'
import {
  buildSignedProperties,
  hashSignedProperties,
} from './signed-properties'
import { cleanCertificateBody, getCertificateHash, parseZatcaCertificate } from './x509'
import type { ZatcaCertificateInfo } from './x509'

const DS_NS = 'http://www.w3.org/2000/09/xmldsig#'
const XADES_NS = 'http://uri.etsi.org/01903/v1.3.2#'
const SHA256_DIGEST_METHOD = 'http://www.w3.org/2001/04/xmlenc#sha256'

export interface InvoiceSignResult {
  signedXml: string
  invoiceHashHex: string
  invoiceHashBase64: string
  digitalSignature: string
  signedPropertiesHash: string
  signingTime: string
}

function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function invoiceHashHexToBase64(hexHash: string): string {
  return Buffer.from(hexHash, 'hex').toString('base64')
}

function formatZatcaSigningTime(date = new Date()): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function signInvoiceHashBytes(hashBytes: Buffer, privateKeyPem: string): string {
  try {
    const signer = createSign('SHA256')
    signer.update(hashBytes)
    signer.end()
    return signer.sign({ key: privateKeyPem, dsaEncoding: 'ieee-p1363' }, 'base64')
  } catch {
    const keyObject = createPrivateKey(privateKeyPem)
    const derSignature = createSign('SHA256')
      .update(hashBytes)
      .end()
      .sign(keyObject)
    return derEcdsaSignatureToP1363(derSignature).toString('base64')
  }
}

function derEcdsaSignatureToP1363(signature: Buffer): Buffer {
  const der = forge.asn1.fromDer(signature.toString('binary'))
  const values = der.value as forge.asn1.Asn1[]
  const r = Buffer.from(forge.util.hexToBytes((values[0].value as string)), 'binary')
  const s = Buffer.from(forge.util.hexToBytes((values[1].value as string)), 'binary')
  return Buffer.concat([normalizeEcdsaInteger(r), normalizeEcdsaInteger(s)])
}

function normalizeEcdsaInteger(value: Buffer): Buffer {
  const trimmed = value.length > 32 && value[0] === 0 ? value.subarray(1) : value
  if (trimmed.length > 32) return trimmed.subarray(trimmed.length - 32)
  if (trimmed.length === 32) return trimmed
  return Buffer.concat([Buffer.alloc(32 - trimmed.length), trimmed])
}

function isMockSigningEnabled(): boolean {
  return isMockSubmissionEnabled()
}

function mockCertificateInfo(certificatePem: string): ZatcaCertificateInfo {
  const bodyBase64 = cleanCertificateBody(certificatePem)
  return {
    hash: getCertificateHash(bodyBase64),
    issuer: 'CN=Mock ZATCA CA',
    subject: 'CN=Mock ZATCA CSID',
    serialNumber: '1',
    fingerprint256: '00:00:00:00',
    publicKey: Buffer.alloc(48, 0xab),
    certificateSignature: Buffer.alloc(64, 0xcd),
    bodyBase64,
  }
}

function resolveCertificateInfo(certificatePem: string): ZatcaCertificateInfo {
  if (isMockSigningEnabled()) {
    try {
      return parseZatcaCertificate(certificatePem)
    } catch {
      return mockCertificateInfo(certificatePem)
    }
  }
  return parseZatcaCertificate(certificatePem)
}

function buildUblExtensionsBlock(params: {
  invoiceHashBase64: string
  signedPropertiesHash: string
  digitalSignature: string
  certificateBody: string
  signedPropertiesXml: string
}): string {
  const { invoiceHashBase64, signedPropertiesHash, digitalSignature, certificateBody, signedPropertiesXml } = params

  return `<ext:UBLExtensions>
  <ext:UBLExtension>
    <ext:ExtensionURI>urn:oasis:names:specification:ubl:dsig:enveloped:xades</ext:ExtensionURI>
    <ext:ExtensionContent>
      <sig:UBLDocumentSignatures xmlns:sig="urn:oasis:names:specification:ubl:schema:xsd:CommonSignatureComponents-2" xmlns:sac="urn:oasis:names:specification:ubl:schema:xsd:SignatureAggregateComponents-2" xmlns:sbc="urn:oasis:names:specification:ubl:schema:xsd:SignatureBasicComponents-2" xmlns:ds="${DS_NS}">
        <sac:SignatureInformation>
          <cbc:ID xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">urn:oasis:names:specification:ubl:signature:1</cbc:ID>
          <sbc:ReferencedSignatureID>urn:oasis:names:specification:ubl:signature:Invoice</sbc:ReferencedSignatureID>
          <ds:Signature xmlns:ds="${DS_NS}" Id="signature">
            <ds:SignedInfo>
              <ds:CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/>
              <ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256"/>
              <ds:Reference Id="invoiceSignedData" URI="">
                <ds:Transforms>
                  <ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116">
                    <ds:XPath>not(//ancestor-or-self::ext:UBLExtensions)</ds:XPath>
                  </ds:Transform>
                  <ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116">
                    <ds:XPath>not(//ancestor-or-self::cac:Signature)</ds:XPath>
                  </ds:Transform>
                  <ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116">
                    <ds:XPath>not(//ancestor-or-self::cac:AdditionalDocumentReference[cbc:ID='QR'])</ds:XPath>
                  </ds:Transform>
                </ds:Transforms>
                <ds:DigestMethod Algorithm="${SHA256_DIGEST_METHOD}"/>
                <ds:DigestValue>${invoiceHashBase64}</ds:DigestValue>
              </ds:Reference>
              <ds:Reference Type="http://www.w3.org/2000/09/xmldsig#SignatureProperties" URI="#xadesSignedProperties">
                <ds:DigestMethod Algorithm="${SHA256_DIGEST_METHOD}"/>
                <ds:DigestValue>${signedPropertiesHash}</ds:DigestValue>
              </ds:Reference>
            </ds:SignedInfo>
            <ds:SignatureValue>${escapeXmlAttr(digitalSignature)}</ds:SignatureValue>
            <ds:KeyInfo>
              <ds:X509Data>
                <ds:X509Certificate>${certificateBody}</ds:X509Certificate>
              </ds:X509Data>
            </ds:KeyInfo>
            <ds:Object>
              <xades:QualifyingProperties xmlns:xades="${XADES_NS}" Target="#signature">
                ${signedPropertiesXml}
              </xades:QualifyingProperties>
            </ds:Object>
          </ds:Signature>
        </sac:SignatureInformation>
      </sig:UBLDocumentSignatures>
    </ext:ExtensionContent>
  </ext:UBLExtension>
</ext:UBLExtensions>`
}

/**
 * Signs UBL invoice XML with ZATCA XAdES-BES (SigningTime, SigningCertificate, dual Reference).
 */
export function signInvoiceXml(
  xml: string,
  certificatePem: string,
  privateKeyPem: string,
): string {
  return signInvoiceXmlDetailed(xml, certificatePem, privateKeyPem).signedXml
}

/**
 * Signs invoice XML and returns signature artifacts needed for Phase 2 QR tags 6–9.
 */
export function signInvoiceXmlDetailed(
  xml: string,
  certificatePem: string,
  privateKeyPem: string,
): InvoiceSignResult {
  const unsignedXml = stripSignatureBlock(xml)
    .replace(/^\s*<\?xml[\s\S]*?\?>\s*/i, '')
    .trim()
  const invoiceHashHex = generateZatcaInvoiceHash(unsignedXml)
  const invoiceHashBase64 = invoiceHashHexToBase64(invoiceHashHex)
  const invoiceHashBytes = Buffer.from(invoiceHashBase64, 'base64')

  const certInfo = resolveCertificateInfo(certificatePem)
  const signingTime = formatZatcaSigningTime()

  const signedPropertiesXml = buildSignedProperties({
    signingTime,
    certificateHash: certInfo.hash,
    certificateIssuer: certInfo.issuer,
    certificateSerialNumber: certInfo.serialNumber,
  })
  const signedPropertiesHash = hashSignedProperties(signedPropertiesXml)

  const digitalSignature = isMockSigningEnabled()
    ? createHash('sha256').update(`mock:${invoiceHashBase64}`, 'utf8').digest('base64')
    : signInvoiceHashBytes(invoiceHashBytes, privateKeyPem)

  const signatureBlock = buildUblExtensionsBlock({
    invoiceHashBase64,
    signedPropertiesHash,
    digitalSignature,
    certificateBody: certInfo.bodyBase64,
    signedPropertiesXml,
  })

  const signedXml = unsignedXml.replace(
    /<Invoice([^>]*)>/,
    `<Invoice$1>${signatureBlock}`,
  )

  return {
    signedXml,
    invoiceHashHex,
    invoiceHashBase64,
    digitalSignature,
    signedPropertiesHash,
    signingTime,
  }
}

/**
 * Verifies invoice digest and ECDSA signature value against the embedded certificate.
 */
export function verifyInvoiceSignature(xml: string, certificatePem: string): boolean {
  const signatureMatch = xml.match(/<ds:SignatureValue>([^<]+)<\/ds:SignatureValue>/)
  const digestMatch = xml.match(
    /<ds:Reference[^>]*Id="invoiceSignedData"[^>]*>[\s\S]*?<ds:DigestValue>([^<]+)<\/ds:DigestValue>/,
  ) ?? xml.match(/<ds:DigestValue>([^<]+)<\/ds:DigestValue>/)

  if (!signatureMatch || !digestMatch) return false

  const unsignedXml = stripSignatureBlock(xml)
  const expectedHex = generateZatcaInvoiceHash(unsignedXml)
  const expectedDigest = invoiceHashHexToBase64(expectedHex)

  if (expectedDigest !== digestMatch[1]) return false

  try {
    const hashBytes = Buffer.from(digestMatch[1], 'base64')
    const verifier = createVerify('SHA256')
    verifier.update(hashBytes)
    verifier.end()
    return verifier.verify(
      { key: certificatePem, dsaEncoding: 'ieee-p1363' },
      signatureMatch[1],
      'base64',
    )
  } catch {
    if (isMockSigningEnabled()) return true
    return false
  }
}

export function extractSignatureValuesFromXml(xml: string): {
  invoiceHashBase64: string | null
  digitalSignature: string | null
} {
  const digestMatch = xml.match(
    /<ds:Reference[^>]*Id="invoiceSignedData"[^>]*>[\s\S]*?<ds:DigestValue>([^<]+)<\/ds:DigestValue>/,
  )
  const signatureMatch = xml.match(/<ds:SignatureValue>([^<]+)<\/ds:SignatureValue>/)
  return {
    invoiceHashBase64: digestMatch?.[1] ?? null,
    digitalSignature: signatureMatch?.[1] ?? null,
  }
}

export { cleanCertificateBody, parseZatcaCertificate } from './x509'
