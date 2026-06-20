import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { getDefaultCompanyId } from './company.repository'
import { mapZatcaCredentialRow, mapZatcaOnboardingRequestRow } from './mappers'
import type {
  SaveCredentialInput,
  ZatcaCredentialRecord,
  ZatcaEnvironment,
  ZatcaOnboardingRequestRecord,
} from './types'

function db(client?: SupabaseClient) {
  return client ?? createAdminClient()
}

async function resolveCompanyId(
  input: { companyId?: string; companySettingsId?: string },
  client?: SupabaseClient,
): Promise<string> {
  return input.companyId ?? input.companySettingsId ?? getDefaultCompanyId(client)
}

/** Mirrors `prisma.zatcaCredential.findUnique({ where: { environment } })` scoped by company. */
export async function getCredential(
  environment: ZatcaEnvironment,
  companyId?: string,
  client?: SupabaseClient,
): Promise<ZatcaCredentialRecord | null> {
  const id = companyId ?? (await getDefaultCompanyId(client))
  const { data, error } = await db(client)
    .from('zatca_credentials')
    .select('*')
    .eq('company_id', id)
    .eq('environment', environment)
    .maybeSingle()

  if (error) throw error
  if (!data) return null
  return mapZatcaCredentialRow(data)
}

/** Mirrors `prisma.zatcaCredential.upsert()` — caller supplies encrypted fields. */
export async function upsertCredential(
  input: SaveCredentialInput,
  client?: SupabaseClient,
): Promise<ZatcaCredentialRecord> {
  const companyId = await resolveCompanyId(input, client)
  const supabase = db(client)

  const row: Record<string, unknown> = {
    company_id: companyId,
    environment: input.environment,
  }

  if (input.egsUnitId !== undefined) row.egs_unit_id = input.egsUnitId
  if (input.requestId !== undefined) row.request_id = input.requestId
  if (input.complianceCsid !== undefined) row.compliance_csid = input.complianceCsid
  if (input.productionCsid !== undefined) row.production_csid = input.productionCsid
  if (input.onboardingStatus !== undefined) row.onboarding_status = input.onboardingStatus
  if (input.lastError !== undefined) row.last_error = input.lastError
  if (input.onboardedAt !== undefined) row.onboarded_at = input.onboardedAt

  if (input.csrEnc !== undefined) {
    row.csr_enc = input.csrEnc
    row.csr = null
  }
  if (input.certificateEnc !== undefined) {
    row.certificate_enc = input.certificateEnc
    row.certificate = null
  }
  if (input.productionCertificateEnc !== undefined) {
    row.production_certificate_enc = input.productionCertificateEnc
    row.production_certificate = null
  }
  if (input.privateKeyEnc !== undefined) row.private_key_enc = input.privateKeyEnc
  if (input.secretEnc !== undefined) row.secret_enc = input.secretEnc
  if (input.binarySecurityTokenEnc !== undefined) {
    row.binary_security_token_enc = input.binarySecurityTokenEnc
  }

  const { data, error } = await supabase
    .from('zatca_credentials')
    .upsert(row, { onConflict: 'company_id,environment' })
    .select('*')
    .single()

  if (error) throw error
  return mapZatcaCredentialRow(data)
}

export async function createOnboardingRequest(
  input: {
    companyId?: string
    environment: ZatcaEnvironment
    egsUnitId: string
    status?: string
  },
  client?: SupabaseClient,
): Promise<ZatcaOnboardingRequestRecord> {
  const companyId = input.companyId ?? (await getDefaultCompanyId(client))
  const { data, error } = await db(client)
    .from('zatca_onboarding_requests')
    .insert({
      company_id: companyId,
      environment: input.environment,
      egs_unit_id: input.egsUnitId,
      status: input.status ?? 'PENDING',
    })
    .select('*')
    .single()

  if (error) throw error
  return mapZatcaOnboardingRequestRow(data)
}

export async function updateOnboardingRequest(
  id: string,
  input: {
    requestId?: string | null
    status?: string
    errorMessage?: string | null
  },
  client?: SupabaseClient,
): Promise<ZatcaOnboardingRequestRecord> {
  const patch: Record<string, unknown> = {}
  if (input.requestId !== undefined) patch.request_id = input.requestId
  if (input.status !== undefined) patch.status = input.status
  if (input.errorMessage !== undefined) patch.error_message = input.errorMessage

  const { data, error } = await db(client)
    .from('zatca_onboarding_requests')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single()

  if (error) throw error
  return mapZatcaOnboardingRequestRow(data)
}

export async function findLatestOnboardingRequest(
  companyId: string,
  environment: ZatcaEnvironment,
  client?: SupabaseClient,
): Promise<ZatcaOnboardingRequestRecord | null> {
  const { data, error } = await db(client)
    .from('zatca_onboarding_requests')
    .select('*')
    .eq('company_id', companyId)
    .eq('environment', environment)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  if (!data) return null
  return mapZatcaOnboardingRequestRow(data)
}
