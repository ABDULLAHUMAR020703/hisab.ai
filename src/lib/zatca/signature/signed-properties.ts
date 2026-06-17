const DS_NS = 'http://www.w3.org/2000/09/xmldsig#'
const XADES_NS = 'http://uri.etsi.org/01903/v1.3.2#'

export interface SignedPropertiesInput {
  signingTime: string
  certificateHash: string
  certificateIssuer: string
  certificateSerialNumber: string
}

/**
 * Compact SignedProperties XML used exclusively for SHA-256 hashing (Step 5).
 * Whitespace must match ZATCA validator expectations.
 */
export function buildSignedPropertiesForHashing(input: SignedPropertiesInput): string {
  return `<xades:SignedProperties xmlns:xades="${XADES_NS}" Id="xadesSignedProperties">
<xades:SignedSignatureProperties>
<xades:SigningTime>${input.signingTime}</xades:SigningTime>
<xades:SigningCertificate>
<xades:Cert>
<xades:CertDigest>
<ds:DigestMethod xmlns:ds="${DS_NS}" Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>
<ds:DigestValue xmlns:ds="${DS_NS}">${input.certificateHash}</ds:DigestValue>
</xades:CertDigest>
<xades:IssuerSerial>
<ds:X509IssuerName xmlns:ds="${DS_NS}">${input.certificateIssuer}</ds:X509IssuerName>
<ds:X509SerialNumber xmlns:ds="${DS_NS}">${input.certificateSerialNumber}</ds:X509SerialNumber>
</xades:IssuerSerial>
</xades:Cert>
</xades:SigningCertificate>
</xades:SignedSignatureProperties>
</xades:SignedProperties>`
}

/**
 * SignedProperties block embedded in the final signed invoice XML.
 */
export function buildSignedPropertiesForEmbedding(input: SignedPropertiesInput): string {
  return `<xades:SignedProperties xmlns:xades="${XADES_NS}" Id="xadesSignedProperties">
                                    <xades:SignedSignatureProperties>
                                        <xades:SigningTime>${input.signingTime}</xades:SigningTime>
                                        <xades:SigningCertificate>
                                            <xades:Cert>
                                                <xades:CertDigest>
                                                    <ds:DigestMethod xmlns:ds="${DS_NS}" Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>
                                                    <ds:DigestValue xmlns:ds="${DS_NS}">${input.certificateHash}</ds:DigestValue>
                                                </xades:CertDigest>
                                                <xades:IssuerSerial>
                                                    <ds:X509IssuerName xmlns:ds="${DS_NS}">${input.certificateIssuer}</ds:X509IssuerName>
                                                    <ds:X509SerialNumber xmlns:ds="${DS_NS}">${input.certificateSerialNumber}</ds:X509SerialNumber>
                                                </xades:IssuerSerial>
                                            </xades:Cert>
                                        </xades:SigningCertificate>
                                    </xades:SignedSignatureProperties>
                                </xades:SignedProperties>`
}

import { createHash } from 'crypto'

export function hashSignedProperties(signedPropertiesXml: string): string {
  const hexDigest = createHash('sha256').update(signedPropertiesXml, 'utf8').digest('hex')
  return Buffer.from(hexDigest, 'utf8').toString('base64')
}
