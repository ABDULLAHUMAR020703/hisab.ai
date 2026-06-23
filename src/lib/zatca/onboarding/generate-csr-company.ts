import type { CompanySettings } from '@/lib/db/prisma-types'
import type { ZatcaCsrSubjectInput } from './types'
import { buildCompanyRegisteredAddress, type CompanyCsrInput } from './egs-identity'
import { generateZatcaCsr } from './generate-csr'

/**
 * Generates a ZATCA CSR from company profile data.
 * Keys, EGS identity, and CSR structure are created automatically — never user-supplied.
 */
export async function generateCSR(company: CompanyCsrInput) {
  const organizationName = (company.legalName || company.companyName).trim()
  const input: ZatcaCsrSubjectInput = {
    environment: company.environment,
    vatNumber: company.taxId,
    commercialRegistration: company.commercialRegistration,
    organizationName,
    organizationUnit: company.district?.trim() || company.city?.trim() || 'Main Branch',
    solutionName: company.egsIdentity.solutionName,
    egsModel: company.egsIdentity.egsModel,
    egsSerialNumber: company.egsIdentity.egsSerialNumber,
    registeredAddress: buildCompanyRegisteredAddress(company),
    businessCategory: company.egsIdentity.businessCategory,
  }

  return generateZatcaCsr(input)
}

export function companySettingsToCsrInput(
  settings: CompanySettings,
  egsIdentity: CompanyCsrInput['egsIdentity'],
): CompanyCsrInput {
  return {
    environment: settings.zatcaEnvironment,
    legalName: settings.legalName,
    companyName: settings.companyName,
    taxId: settings.taxId!,
    commercialRegistration: settings.commercialRegistration,
    buildingNumber: settings.buildingNumber,
    streetAddress: settings.streetAddress,
    address: settings.address,
    district: settings.district,
    city: settings.city,
    postalCode: settings.postalCode,
    egsIdentity,
  }
}
