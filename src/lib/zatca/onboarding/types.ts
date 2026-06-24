import type { ZatcaEnvironment, ZatcaOnboardingStatus } from '@/lib/db/prisma-types'

export interface ZatcaCsrSubjectInput {
  environment: ZatcaEnvironment
  vatNumber: string
  commercialRegistration?: string | null
  organizationName: string
  organizationUnit?: string | null
  solutionName?: string
  /** Auto-generated EGS unit common name (CSR CN). */
  egsUnitId?: string | null
  egsModel?: string | null
  egsSerialNumber?: string | null
  registeredAddress?: string | null
  businessCategory?: string | null
  invoiceTypes?: string
}

export interface ZatcaCsrResult {
  csrPem: string
  csrBase64: string
  privateKeyPem: string
  commonName: string
}

export interface ComplianceCsidRequest {
  csrBase64: string
  otp: string
  environment: ZatcaEnvironment
}

export interface ComplianceCsidResponse {
  requestId: string
  dispositionMessage: string
  binarySecurityToken: string
  secret: string
  certificatePem: string
}

export interface ProductionCsidResponse {
  requestId: string
  dispositionMessage: string
  binarySecurityToken: string
  secret: string
  certificatePem: string
}

export interface OnboardingAuditContext {
  userId?: string
  userName?: string | null
}

export interface ZatcaOnboardingStatusView {
  environment: ZatcaEnvironment
  onboardingStatus: ZatcaOnboardingStatus
  connectionStatus: 'NOT_CONNECTED' | 'PENDING' | 'CONNECTED' | 'FAILED'
  zatcaConnected: boolean
  egsUnitId: string | null
  hasCsr: boolean
  hasCertificate: boolean
  hasComplianceCsid: boolean
  hasProductionCsid: boolean
  onboardedAt: string | null
  lastError: string | null
  requestId: string | null
  updatedAt: string
}

export interface SaveCredentialInput {
  environment: ZatcaEnvironment
  companySettingsId?: string
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
}
