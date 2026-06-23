import type { ZatcaEnvironment } from '@/lib/db/prisma-types'

export interface ZatcaCsrTemplateInput {
  environment: ZatcaEnvironment
  solutionName: string
  egsModel: string
  egsSerialNumber: string
  vatNumber: string
  organizationIdentifier: string
  organizationName: string
  organizationUnit: string
  commonName: string
  registeredAddress: string
  businessCategory: string
  invoiceTypes: string
}

function certificateTemplateName(environment: ZatcaEnvironment): string {
  return environment === 'SANDBOX' ? 'PREZATCA-Code-Signing' : 'ZATCA-Code-Signing'
}

/**
 * OpenSSL configuration for a ZATCA-compliant PKCS#10 CSR.
 *
 * Matches the official ZATCA SDK config exactly:
 * - Subject DN is C, OU, O, CN only (no organizationIdentifier; VAT goes in SAN UID).
 * - certificateTemplateName is encoded as PRINTABLESTRING (ZATCA spec; production rejects UTF8String).
 * - No basicConstraints / keyUsage (the SDK reference config omits them).
 */
export function buildZatcaOpenSslConfig(input: ZatcaCsrTemplateInput): string {
  const template = certificateTemplateName(input.environment)

  return `oid_section = OIDs

[OIDs]
certificateTemplateName = 1.3.6.1.4.1.311.20.2

[req]
prompt = no
distinguished_name = dn
req_extensions = v3_req

[dn]
C = SA
OU = ${escapeOpenSslValue(input.organizationUnit)}
O = ${escapeOpenSslValue(input.organizationName)}
CN = ${escapeOpenSslValue(input.commonName)}

[v3_req]
certificateTemplateName = ASN1:PRINTABLESTRING:${template}
subjectAltName = dirName:alt_names

[alt_names]
SN = 1-${escapeOpenSslValue(input.solutionName)}|2-${escapeOpenSslValue(input.egsModel)}|3-${escapeOpenSslValue(input.egsSerialNumber)}
UID = ${escapeOpenSslValue(input.vatNumber)}
title = ${escapeOpenSslValue(input.invoiceTypes)}
registeredAddress = ${escapeOpenSslValue(input.registeredAddress)}
businessCategory = ${escapeOpenSslValue(input.businessCategory)}
`
}

function escapeOpenSslValue(value: string): string {
  return value.replace(/[\r\n]/g, ' ').trim()
}
