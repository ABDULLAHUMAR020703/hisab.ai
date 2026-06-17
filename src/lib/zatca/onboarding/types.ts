import type { ZatcaEnvironment, ZatcaOnboardingStatus } from '@prisma/client'

export interface ZatcaCsrSubjectInput {
  environment: ZatcaEnvironment
  vatNumber: string
  organizationName: string
  organizationUnit?: string | null
  solutionName?: string
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

export interface ZatcaOnboardingStatusView {
  environment: ZatcaEnvironment
  onboardingStatus: ZatcaOnboardingStatus
  hasCsr: boolean
  hasCertificate: boolean
  hasComplianceCsid: boolean
  hasProductionCsid: boolean
  onboardedAt: string | null
  lastError: string | null
  updatedAt: string
}

export interface SaveCredentialInput {
  environment: ZatcaEnvironment
  csr?: string
  privateKeyPem?: string
  certificate?: string
  secret?: string
  complianceCsid?: string
  productionCsid?: string
  productionCertificate?: string
  onboardingStatus?: ZatcaOnboardingStatus
  lastError?: string | null
  onboardedAt?: Date | null
}
