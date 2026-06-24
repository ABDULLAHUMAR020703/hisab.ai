import type { InvoiceType, ZatcaEnvironment, ZatcaInvoiceStatus } from '@/lib/db/prisma-types'
import { resolveZatcaSubmissionRoute } from '../constants'

export type ZatcaSubmissionRoute = 'clearance' | 'reporting'

export interface InvoiceSubmissionResult {
  invoiceId: string
  route: ZatcaSubmissionRoute
  zatcaStatus: ZatcaInvoiceStatus
  requestId: string | null
  responseCode: string | null
  responseMessage: string | null
  submittedAt: string | null
  environment: ZatcaEnvironment
}

export interface InvoiceStatusView {
  invoiceId: string
  invoiceNo: string
  zatcaStatus: ZatcaInvoiceStatus
  requestId: string | null
  responseCode: string | null
  responseMessage: string | null
  clearanceStatus: string | null
  submittedAt: string | null
  canSubmit: boolean
}

export interface InvoiceResponseView {
  invoiceId: string
  zatcaStatus: ZatcaInvoiceStatus
  requestId: string | null
  responseCode: string | null
  responseMessage: string | null
  submittedAt: string | null
  clearanceStatus: string | null
  zatcaResponse: Record<string, unknown> | null
  hasClearedPayload: boolean
}

export function resolveSubmissionRoute(
  invoiceType: InvoiceType,
  environment: ZatcaEnvironment = 'SANDBOX',
): ZatcaSubmissionRoute {
  return resolveZatcaSubmissionRoute(invoiceType, environment)
}

export const TERMINAL_ZATCA_STATUSES: ZatcaInvoiceStatus[] = [
  'CLEARED',
  'REPORTED',
  'SUBMITTED',
]
