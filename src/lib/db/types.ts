/** Domain types for Supabase repositories (Prisma-compatible shapes). */

export type ZatcaEnvironment = 'SANDBOX' | 'PRODUCTION'

export type ZatcaOnboardingStatus =
  | 'NOT_STARTED'
  | 'CSR_GENERATED'
  | 'COMPLIANCE_ISSUED'
  | 'COMPLIANCE_VALIDATED'
  | 'PRODUCTION_ISSUED'
  | 'PRODUCTION_READY'
  | 'FAILED'

export type CompanyRole =
  | 'OWNER'
  | 'ADMIN'
  | 'ACCOUNTANT'
  | 'MANAGER'
  | 'EMPLOYEE'
  | 'AUDITOR'

/** Merged view matching Prisma `CompanySettings` for drop-in replacement. */
export interface CompanySettingsRecord {
  id: string
  companyName: string
  legalName: string | null
  taxId: string | null
  commercialRegistration: string | null
  address: string | null
  streetAddress: string | null
  buildingNumber: string | null
  district: string | null
  city: string | null
  postalCode: string | null
  country: string
  phone: string | null
  email: string | null
  website: string | null
  logoUrl: string | null
  currency: string
  fiscalYearStart: string
  zatcaEnabled: boolean
  zatcaConnected: boolean
  zatcaConnectedAt: Date | null
  zatcaEnvironment: ZatcaEnvironment
  zatcaEgsUnitId: string | null
  zatcaDeviceIdentifier: string | null
  zatcaEgsSerialNumber: string | null
  zatcaBusinessCategory: string | null
  createdAt: Date
  updatedAt: Date
}

export interface CompanySettingsUpdateInput {
  companyName?: string
  legalName?: string | null
  taxId?: string | null
  commercialRegistration?: string | null
  address?: string | null
  streetAddress?: string | null
  buildingNumber?: string | null
  district?: string | null
  city?: string | null
  postalCode?: string | null
  country?: string
  phone?: string | null
  email?: string | null
  website?: string | null
  logoUrl?: string | null
  currency?: string
  fiscalYearStart?: string
  zatcaEnabled?: boolean
  zatcaConnected?: boolean
  zatcaConnectedAt?: Date | null
  zatcaEnvironment?: ZatcaEnvironment
  zatcaEgsUnitId?: string | null
  zatcaDeviceIdentifier?: string | null
  zatcaEgsSerialNumber?: string | null
  zatcaBusinessCategory?: string | null
}

export interface CompanyRecord {
  id: string
  slug: string
  companyName: string
  legalName: string | null
  taxId: string | null
  commercialRegistration: string | null
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

export interface ProfileRecord {
  id: string
  fullName: string | null
  avatarUrl: string | null
  phone: string | null
  legacyUserId: string | null
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

export interface CompanyUserRecord {
  id: string
  companyId: string
  userId: string
  role: CompanyRole
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

/** Prisma `ZatcaCredential` parity. */
export interface ZatcaCredentialRecord {
  id: string
  companySettingsId: string | null
  companyId: string
  environment: ZatcaEnvironment
  egsUnitId: string | null
  csr: string | null
  csrEnc: string | null
  privateKeyEnc: string | null
  certificate: string | null
  certificateEnc: string | null
  secretEnc: string | null
  binarySecurityTokenEnc: string | null
  productionBinarySecurityTokenEnc: string | null
  complianceCsid: string | null
  requestId: string | null
  productionCsid: string | null
  productionCertificate: string | null
  productionCertificateEnc: string | null
  complianceCertIssuedAt: Date | null
  complianceCertValidFrom: Date | null
  complianceCertValidTo: Date | null
  productionCertIssuedAt: Date | null
  productionCertValidFrom: Date | null
  productionCertValidTo: Date | null
  onboardingStatus: ZatcaOnboardingStatus
  lastError: string | null
  onboardedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface SaveCredentialInput {
  environment: ZatcaEnvironment
  companySettingsId?: string
  companyId?: string
  egsUnitId?: string
  csr?: string
  privateKeyPem?: string
  certificate?: string
  binarySecurityToken?: string
  secret?: string
  complianceCsid?: string
  requestId?: string
  productionCsid?: string
  productionCertificate?: string
  productionBinarySecurityToken?: string
  onboardingStatus?: ZatcaOnboardingStatus
  lastError?: string | null
  onboardedAt?: Date | null
  csrEnc?: string
  privateKeyEnc?: string
  certificateEnc?: string
  secretEnc?: string
  binarySecurityTokenEnc?: string
  productionCertificateEnc?: string
  productionBinarySecurityTokenEnc?: string
  complianceCertIssuedAt?: Date | null
  complianceCertValidFrom?: Date | null
  complianceCertValidTo?: Date | null
  productionCertIssuedAt?: Date | null
  productionCertValidFrom?: Date | null
  productionCertValidTo?: Date | null
}

export interface ZatcaOnboardingRequestRecord {
  id: string
  companySettingsId: string
  companyId: string
  environment: ZatcaEnvironment
  egsUnitId: string
  requestId: string | null
  status: string
  errorMessage: string | null
  createdAt: Date
  updatedAt: Date
}
