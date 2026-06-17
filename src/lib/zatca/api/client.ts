import 'server-only'
import type { ZatcaEnvironment } from '@prisma/client'
import { buildBasicAuthHeader, loadSigningCredentials } from '../signature/certificate'

export function getZatcaApiBaseUrl(): string {
  return process.env.ZATCA_API_BASE_URL ?? 'https://gw-fatoora.zatca.gov.sa'
}

export function isMockSubmission(): boolean {
  return process.env.ZATCA_MOCK_SUBMISSION === 'true' || process.env.ZATCA_MOCK_ONBOARDING === 'true'
}

const API_PREFIX: Record<ZatcaEnvironment, string> = {
  SANDBOX: '/e-invoicing/simulation',
  PRODUCTION: '/e-invoicing/core',
}

export function resolveApiPath(environment: ZatcaEnvironment, suffix: string): string {
  return `${getZatcaApiBaseUrl()}${API_PREFIX[environment]}${suffix}`
}

export async function buildZatcaAuthHeaders(environment: ZatcaEnvironment) {
  const creds = await loadSigningCredentials(environment)
  return {
    Authorization: buildBasicAuthHeader(creds.csidToken, creds.secret),
    Accept: 'application/json',
    'Accept-Version': 'V2',
    'Accept-Language': 'en',
  }
}

export interface ZatcaApiError {
  code?: string
  message?: string
}

export interface ZatcaApiResponseBody {
  validationResults?: {
    status?: string
    infoMessages?: Array<{ code?: string; message?: string }>
    warningMessages?: Array<{ code?: string; message?: string }>
    errorMessages?: Array<{ code?: string; message?: string }>
  }
  reportingStatus?: string
  clearanceStatus?: string
  clearedInvoice?: string
  qrSellertStatus?: string
  qrBuyertStatus?: string
  requestID?: string
  errors?: ZatcaApiError[] | null
}
