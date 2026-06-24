import 'server-only'
import type { ZatcaEnvironment } from '@/lib/db/prisma-types'
import { backfillCertificateValidity, getCredential } from './credential-store'

export type CertificateLifecycleStatus = 'VALID' | 'EXPIRING_SOON' | 'EXPIRED' | 'MISSING'

export interface CertificateStatusItem {
  kind: 'COMPLIANCE' | 'PRODUCTION'
  status: CertificateLifecycleStatus
  issuedAt: string | null
  validFrom: string | null
  validTo: string | null
  daysRemaining: number | null
}

export interface CertificateStatusSummary {
  environment: ZatcaEnvironment
  compliance: CertificateStatusItem
  production: CertificateStatusItem
}

const EXPIRING_SOON_DAYS = Number(process.env.ZATCA_CERT_EXPIRING_SOON_DAYS ?? 30)

function classify(kind: CertificateStatusItem['kind'], issuedAt?: Date | null, validFrom?: Date | null, validTo?: Date | null): CertificateStatusItem {
  if (!validTo) {
    return {
      kind,
      status: 'MISSING',
      issuedAt: issuedAt?.toISOString() ?? null,
      validFrom: validFrom?.toISOString() ?? null,
      validTo: null,
      daysRemaining: null,
    }
  }

  const msRemaining = validTo.getTime() - Date.now()
  const daysRemaining = Math.ceil(msRemaining / 86_400_000)
  const status: CertificateLifecycleStatus = msRemaining <= 0
    ? 'EXPIRED'
    : daysRemaining <= EXPIRING_SOON_DAYS
      ? 'EXPIRING_SOON'
      : 'VALID'

  return {
    kind,
    status,
    issuedAt: issuedAt?.toISOString() ?? null,
    validFrom: validFrom?.toISOString() ?? null,
    validTo: validTo.toISOString(),
    daysRemaining,
  }
}

export async function getCertificateStatus(environment: ZatcaEnvironment): Promise<CertificateStatusSummary> {
  let credential = await getCredential(environment)
  const complianceNeedsBackfill = Boolean(
    credential?.certificateEnc || credential?.certificate,
  ) && !credential?.complianceCertValidTo
  const productionNeedsBackfill = Boolean(
    credential?.productionCertificateEnc || credential?.productionCertificate,
  ) && !credential?.productionCertValidTo

  if (credential && (complianceNeedsBackfill || productionNeedsBackfill)) {
    credential = await backfillCertificateValidity(environment)
  }

  return {
    environment,
    compliance: classify(
      'COMPLIANCE',
      credential?.complianceCertIssuedAt,
      credential?.complianceCertValidFrom,
      credential?.complianceCertValidTo,
    ),
    production: classify(
      'PRODUCTION',
      credential?.productionCertIssuedAt,
      credential?.productionCertValidFrom,
      credential?.productionCertValidTo,
    ),
  }
}
