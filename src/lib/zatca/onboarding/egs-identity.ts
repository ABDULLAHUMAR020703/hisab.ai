import { createHash, randomBytes } from 'crypto'
import type { CompanySettings, ZatcaEnvironment } from '@prisma/client'

const SOLUTION_NAME = 'hisab.ai'
const DEFAULT_EGS_MODEL = 'hisab.ai'
const DEFAULT_BUSINESS_CATEGORY = 'Telecommunications'

export interface EgsIdentity {
  /** CSR Common Name — ZATCA simulation: TST-{VAT}; production: {VAT} */
  egsUnitId: string
  deviceIdentifier: string
  egsSerialNumber: string
  egsModel: string
  solutionName: string
  businessCategory: string
}

function normalizeVat(vatNumber?: string | null): string {
  return (vatNumber ?? '').replace(/\D/g, '')
}

/**
 * Generates EGS identity aligned with ZATCA Fatoora CSR rules.
 * Simulation CN must be TST-{VAT}; production CN is the 15-digit VAT.
 */
export function generateEgsIdentity(
  companyName: string | null | undefined,
  vatNumber: string | null | undefined,
  environment: ZatcaEnvironment = 'SANDBOX',
): EgsIdentity {
  const vat = normalizeVat(vatNumber)
  const egsUnitId = environment === 'SANDBOX' ? `TST-${vat}` : vat

  const vatSuffix = vat.slice(-6) || randomBytes(3).toString('hex')
  const deviceIdentifier = `HISAB-${vatSuffix}`
  const egsSerialNumber = createHash('sha256')
    .update(`hisab-zatca-egs:${vat}:${environment}`)
    .digest('hex')
    .slice(0, 32)

  return {
    egsUnitId,
    deviceIdentifier,
    egsSerialNumber,
    egsModel: DEFAULT_EGS_MODEL,
    solutionName: SOLUTION_NAME,
    businessCategory: DEFAULT_BUSINESS_CATEGORY,
  }
}

export interface CompanyCsrInput {
  environment: CompanySettings['zatcaEnvironment']
  legalName: string | null
  companyName: string
  taxId: string
  commercialRegistration: string | null
  buildingNumber: string | null
  streetAddress: string | null
  address: string | null
  district: string | null
  city: string | null
  postalCode: string | null
  egsIdentity: EgsIdentity
}

export function buildCompanyRegisteredAddress(company: Pick<
  CompanySettings,
  'buildingNumber' | 'streetAddress' | 'address' | 'district' | 'city' | 'postalCode'
>): string {
  return [
    company.buildingNumber,
    company.streetAddress || company.address,
    company.district,
    company.city,
    company.postalCode,
  ].filter(Boolean).join(', ') || company.city || 'Riyadh'
}
