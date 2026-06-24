import 'server-only'
import type { ZatcaEnvironment } from '@/lib/db/prisma-types'
import { getDefaultCompanyId } from '@/lib/db/company.repository'
import { createAdminClient } from '@/lib/supabase/admin'
import type { ZatcaApiResponseBody } from './client'

const REDACTED_PAYLOAD_KEYS = new Set([
  'binarysecuritytoken',
  'secret',
  'invoice',
  'clearedinvoice',
  'csr',
])

export function extractBodyRequestId(body: ZatcaApiResponseBody): string {
  const value = body.requestID ?? body.requestId ?? body.request_id
  return value === undefined || value === null ? '' : String(value)
}

export function extractGlobalTransactionId(headers: Headers): string {
  return headers.get('x-global-transaction-id') ?? ''
}

export function resolveZatcaTraceId(requestId: string, globalTransactionId: string): string {
  const bodyId = requestId.trim()
  if (bodyId) return bodyId
  return globalTransactionId.trim()
}

export function sanitizeZatcaResponsePayload(
  body: ZatcaApiResponseBody | Record<string, unknown>,
): Record<string, unknown> {
  const output: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(body)) {
    if (REDACTED_PAYLOAD_KEYS.has(key.toLowerCase())) {
      if (typeof value === 'string') {
        output[key] = `[REDACTED length=${value.length}]`
      } else {
        output[key] = '[REDACTED]'
      }
      continue
    }
    output[key] = value
  }

  return output
}

export async function persistZatcaApiLog(input: {
  environment: ZatcaEnvironment
  endpoint: string
  invoiceId?: string | null
  status: number
  ok: boolean
  requestId: string
  globalTransactionId: string
  correlationId: string
  durationMs: number
  errorMessage: string | null
  attempt: number
  warningCount: number
  errorCount: number
  responsePayload?: Record<string, unknown> | null
}) {
  try {
    const supabase = createAdminClient()
    const companyId = await getDefaultCompanyId(supabase)
    const metadata = {
      correlationId: input.correlationId,
      attempt: input.attempt,
      warningCount: input.warningCount,
      errorCount: input.errorCount,
      bodyRequestId: input.requestId || null,
      globalTransactionId: input.globalTransactionId || null,
      responsePayload: input.responsePayload ?? null,
    }
    const baseRow = {
      company_id: companyId,
      environment: input.environment,
      endpoint: input.endpoint,
      http_method: 'POST',
      request_id: resolveZatcaTraceId(input.requestId, input.globalTransactionId) || input.correlationId,
      response_code: String(input.status),
      success: input.ok,
      error_message: input.errorMessage,
      duration_ms: input.durationMs,
      invoice_id: input.invoiceId ?? null,
      metadata,
    }
    const withTraceColumns = {
      ...baseRow,
      global_transaction_id: input.globalTransactionId || null,
      response_payload: input.responsePayload ?? null,
    }

    let { error } = await supabase.from('zatca_api_logs').insert(withTraceColumns)
    if (error && /global_transaction_id|response_payload|column/i.test(error.message)) {
      ;({ error } = await supabase.from('zatca_api_logs').insert(baseRow))
    }
    if (error) throw error
  } catch {
    // API log persistence must never break ZATCA workflows.
  }
}
