import 'server-only'
import { generateKeyPairSync } from 'crypto'
import forge from 'node-forge'
import type { ZatcaCsrResult, ZatcaCsrSubjectInput } from './types'

const SOLUTION_NAME = 'hisab.ai'
const DEFAULT_INVOICE_TYPES = '1100'
const DEFAULT_BUSINESS_CATEGORY = 'Telecommunications'

function buildCommonName(environment: ZatcaCsrSubjectInput['environment'], vatNumber: string): string {
  const vat = vatNumber.replace(/\D/g, '')
  return environment === 'SANDBOX' ? `TST-${vat}` : vat
}

function buildSerialNumber(solutionName: string): string {
  return `1-${solutionName}|2-${solutionName}|3-${solutionName}`
}

export function csrPemToBase64(csrPem: string): string {
  return csrPem
    .replace(/-----BEGIN CERTIFICATE REQUEST-----/g, '')
    .replace(/-----END CERTIFICATE REQUEST-----/g, '')
    .replace(/\s+/g, '')
}

function setZatcaSanExtension(
  csr: ReturnType<typeof forge.pki.createCertificationRequest>,
  input: ZatcaCsrSubjectInput,
  solutionName: string,
) {
  const vat = input.vatNumber.replace(/\D/g, '')
  const address = input.registeredAddress?.trim() || 'Riyadh'
  const businessCategory = input.businessCategory?.trim() || DEFAULT_BUSINESS_CATEGORY
  const invoiceTypes = input.invoiceTypes || DEFAULT_INVOICE_TYPES

  csr.setAttributes([{
    name: 'extensionRequest',
    extensions: [{
      name: 'subjectAltName',
      altNames: [{
        type: 4,
        value: [
          { type: '2.5.4.5', value: buildSerialNumber(solutionName) },
          { type: '0.9.2342.19200300.100.1.1', value: vat },
          { type: '2.5.4.12', value: invoiceTypes },
          { type: '2.5.4.26', value: address },
          { type: '2.5.4.15', value: businessCategory },
        ],
      }],
    }],
  }])
}

/**
 * Generates an ECDSA secp256k1 CSR aligned with ZATCA Fatoora onboarding requirements.
 */
export function generateZatcaCsr(input: ZatcaCsrSubjectInput): ZatcaCsrResult {
  const vat = input.vatNumber.replace(/\D/g, '')
  if (vat.length !== 15) {
    throw new Error('VAT registration number must be 15 digits for ZATCA CSR generation')
  }

  const solutionName = input.solutionName?.trim() || SOLUTION_NAME
  const commonName = buildCommonName(input.environment, vat)
  const organizationName = input.organizationName.trim()
  const organizationUnit = input.organizationUnit?.trim() || 'Main Branch'

  const { privateKey, publicKey } = generateKeyPairSync('ec', {
    namedCurve: 'secp256k1',
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })

  const privateKeyPem = privateKey.toString()
  const publicKeyDer = Buffer.isBuffer(publicKey) ? publicKey : Buffer.from(publicKey)
  const publicKeyAsn1 = forge.asn1.fromDer(publicKeyDer.toString('binary'))
  const forgePublicKey = forge.pki.publicKeyFromAsn1(publicKeyAsn1)
  const forgePrivateKey = forge.pki.privateKeyFromPem(privateKeyPem)

  const csr = forge.pki.createCertificationRequest()
  csr.publicKey = forgePublicKey
  csr.setSubject([
    { name: 'countryName', value: 'SA' },
    { name: 'organizationalUnitName', value: organizationUnit },
    { name: 'organizationName', value: organizationName },
    { name: 'commonName', value: commonName },
  ])

  setZatcaSanExtension(csr, input, solutionName)
  csr.sign(forgePrivateKey, forge.md.sha256.create())

  const csrPem = forge.pki.certificationRequestToPem(csr)
  const csrBase64 = csrPemToBase64(csrPem)

  return { csrPem, csrBase64, privateKeyPem, commonName }
}
