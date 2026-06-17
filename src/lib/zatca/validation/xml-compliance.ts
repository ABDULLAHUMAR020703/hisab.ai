import type { InvoiceType } from '@prisma/client'
import { ZATCA_PROFILE_BY_TYPE } from '../constants'
import type { ZatcaValidationIssue, ZatcaValidationResult } from '../types'

function issue(
  code: string,
  field: string,
  message: string,
  severity: 'error' | 'warning' = 'error',
): ZatcaValidationIssue {
  return { code, field, message, severity }
}

export interface XmlComplianceInput {
  xml: string
  invoiceType: InvoiceType
}

/**
 * Static XML compliance checks against ZATCA UBL requirements (offline review).
 */
export function validateXmlCompliance(input: XmlComplianceInput): ZatcaValidationResult {
  const errors: ZatcaValidationIssue[] = []
  const warnings: ZatcaValidationIssue[] = []
  const { xml, invoiceType } = input

  if (!xml.includes('xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"')) {
    errors.push(issue('XML_NS_INVOICE', 'xml', 'Missing Invoice root namespace'))
  }
  if (!xml.includes('xmlns:cac=')) {
    errors.push(issue('XML_NS_CAC', 'xml', 'Missing cac namespace'))
  }
  if (!xml.includes('xmlns:cbc=')) {
    errors.push(issue('XML_NS_CBC', 'xml', 'Missing cbc namespace'))
  }

  const expectedProfile = ZATCA_PROFILE_BY_TYPE[invoiceType]
  if (!xml.includes(`<cbc:ProfileID>${expectedProfile}</cbc:ProfileID>`)) {
    errors.push(issue(
      'XML_PROFILE_MISMATCH',
      'cbc:ProfileID',
      `Expected ProfileID ${expectedProfile} for ${invoiceType}`,
    ))
  }

  if (!xml.includes('<cbc:UUID>')) {
    errors.push(issue('XML_UUID_MISSING', 'cbc:UUID', 'Invoice UUID is required'))
  }

  if (!xml.includes('<cbc:ID>ICV</cbc:ID>')) {
    errors.push(issue('XML_ICV_MISSING', 'AdditionalDocumentReference', 'ICV reference is required'))
  }
  if (!xml.includes('<cbc:ID>PIH</cbc:ID>')) {
    errors.push(issue('XML_PIH_MISSING', 'AdditionalDocumentReference', 'PIH reference is required'))
  }

  if (invoiceType !== 'STANDARD' && !xml.includes('<cbc:ID>QR</cbc:ID>')) {
    warnings.push(issue(
      'XML_QR_MISSING',
      'AdditionalDocumentReference',
      'QR reference recommended for simplified/reporting invoices',
      'warning',
    ))
  }

  if (!xml.includes('urn:oasis:names:specification:ubl:signature:Invoice')) {
    errors.push(issue('XML_UBL_SIGNATURE_STUB', 'cac:Signature', 'UBL signature stub is required'))
  }

  if (!xml.includes('schemeID="VAT"')) {
    warnings.push(issue('XML_SUPPLIER_VAT', 'supplier', 'Supplier VAT schemeID not found', 'warning'))
  }

  if (invoiceType === 'STANDARD' && !xml.match(/AccountingCustomerParty[\s\S]*schemeID="VAT"/)) {
    warnings.push(issue('XML_CUSTOMER_VAT', 'customer', 'Customer VAT may be required for standard invoices', 'warning'))
  }

  if (xml.includes('>0000<') || xml.includes('>Not Provided<')) {
    warnings.push(issue(
      'XML_PLACEHOLDER_ADDRESS',
      'address',
      'Placeholder address values detected (0000, Not Provided)',
      'warning',
    ))
  }

  return { valid: errors.length === 0, errors, warnings }
}
