import type {
  CompanyRecord,
  CompanySettingsRecord,
  CompanyUserRecord,
  ProfileRecord,
  ZatcaCredentialRecord,
  ZatcaOnboardingRequestRecord,
} from './types'

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null
  return new Date(value)
}

function requireDate(value: string): Date {
  return new Date(value)
}

export function mapCompanyRow(row: Record<string, unknown>): CompanyRecord {
  return {
    id: String(row.id),
    slug: String(row.slug),
    companyName: String(row.company_name),
    legalName: (row.legal_name as string | null) ?? null,
    taxId: (row.tax_id as string | null) ?? null,
    commercialRegistration: (row.commercial_registration as string | null) ?? null,
    isActive: Boolean(row.is_active),
    createdAt: requireDate(String(row.created_at)),
    updatedAt: requireDate(String(row.updated_at)),
  }
}

export function mapCompanySettingsRows(
  company: Record<string, unknown>,
  settings: Record<string, unknown> | null,
  zatca: Record<string, unknown> | null,
): CompanySettingsRecord {
  return {
    id: String(company.id),
    companyName: String(company.company_name),
    legalName: (company.legal_name as string | null) ?? null,
    taxId: (company.tax_id as string | null) ?? null,
    commercialRegistration: (company.commercial_registration as string | null) ?? null,
    address: (company.address as string | null) ?? null,
    streetAddress: (company.street_address as string | null) ?? null,
    buildingNumber: (company.building_number as string | null) ?? null,
    district: (company.district as string | null) ?? null,
    city: (company.city as string | null) ?? null,
    postalCode: (company.postal_code as string | null) ?? null,
    country: String(company.country ?? 'Saudi Arabia'),
    phone: (company.phone as string | null) ?? null,
    email: (company.email as string | null) ?? null,
    currency: String(company.currency ?? 'SAR'),
    fiscalYearStart: String(company.fiscal_year_start ?? '01-01'),
    zatcaEnabled: Boolean(zatca?.zatca_enabled ?? false),
    zatcaConnected: Boolean(zatca?.zatca_connected ?? false),
    zatcaConnectedAt: toDate(zatca?.zatca_connected_at as string | null | undefined),
    zatcaEnvironment: (zatca?.zatca_environment as CompanySettingsRecord['zatcaEnvironment']) ?? 'SANDBOX',
    zatcaEgsUnitId: (zatca?.zatca_egs_unit_id as string | null) ?? null,
    zatcaDeviceIdentifier: (zatca?.zatca_device_identifier as string | null) ?? null,
    zatcaEgsSerialNumber: (zatca?.zatca_egs_serial_number as string | null) ?? null,
    zatcaBusinessCategory: (zatca?.zatca_business_category as string | null) ?? null,
    createdAt: requireDate(String(company.created_at)),
    updatedAt: requireDate(String(company.updated_at)),
  }
}

export function mapProfileRow(row: Record<string, unknown>): ProfileRecord {
  return {
    id: String(row.id),
    fullName: (row.full_name as string | null) ?? null,
    avatarUrl: (row.avatar_url as string | null) ?? null,
    phone: (row.phone as string | null) ?? null,
    legacyUserId: (row.legacy_user_id as string | null) ?? null,
    isActive: Boolean(row.is_active),
    createdAt: requireDate(String(row.created_at)),
    updatedAt: requireDate(String(row.updated_at)),
  }
}

export function mapCompanyUserRow(row: Record<string, unknown>): CompanyUserRecord {
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    userId: String(row.user_id),
    role: row.role as CompanyUserRecord['role'],
    isActive: Boolean(row.is_active),
    createdAt: requireDate(String(row.created_at)),
    updatedAt: requireDate(String(row.updated_at)),
  }
}

export function mapZatcaCredentialRow(row: Record<string, unknown>): ZatcaCredentialRecord {
  const companyId = String(row.company_id)
  return {
    id: String(row.id),
    companySettingsId: companyId,
    companyId,
    environment: row.environment as ZatcaCredentialRecord['environment'],
    egsUnitId: (row.egs_unit_id as string | null) ?? null,
    csr: (row.csr as string | null) ?? null,
    csrEnc: (row.csr_enc as string | null) ?? null,
    privateKeyEnc: (row.private_key_enc as string | null) ?? null,
    certificate: (row.certificate as string | null) ?? null,
    certificateEnc: (row.certificate_enc as string | null) ?? null,
    secretEnc: (row.secret_enc as string | null) ?? null,
    binarySecurityTokenEnc: (row.binary_security_token_enc as string | null) ?? null,
    complianceCsid: (row.compliance_csid as string | null) ?? null,
    requestId: (row.request_id as string | null) ?? null,
    productionCsid: (row.production_csid as string | null) ?? null,
    productionCertificate: (row.production_certificate as string | null) ?? null,
    productionCertificateEnc: (row.production_certificate_enc as string | null) ?? null,
    onboardingStatus: row.onboarding_status as ZatcaCredentialRecord['onboardingStatus'],
    lastError: (row.last_error as string | null) ?? null,
    onboardedAt: toDate(row.onboarded_at as string | null | undefined),
    createdAt: requireDate(String(row.created_at)),
    updatedAt: requireDate(String(row.updated_at)),
  }
}

export function mapZatcaOnboardingRequestRow(row: Record<string, unknown>): ZatcaOnboardingRequestRecord {
  const companyId = String(row.company_id)
  return {
    id: String(row.id),
    companySettingsId: companyId,
    companyId,
    environment: row.environment as ZatcaOnboardingRequestRecord['environment'],
    egsUnitId: String(row.egs_unit_id),
    requestId: (row.request_id as string | null) ?? null,
    status: String(row.status),
    errorMessage: (row.error_message as string | null) ?? null,
    createdAt: requireDate(String(row.created_at)),
    updatedAt: requireDate(String(row.updated_at)),
  }
}
