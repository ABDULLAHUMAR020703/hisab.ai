import 'server-only'
import { randomUUID } from 'crypto'
import type { ZatcaEnvironment } from '@/lib/db/prisma-types'
import { getDefaultCompanyId } from '@/lib/db/company.repository'
import { createAdminClient } from '@/lib/supabase/admin'
import type { ZatcaApiResponseBody } from './client'

const DEFAULT_TIMEOUT_MS = Number(process.env.ZATCA_HTTP_TIMEOUT_MS ?? 30000)
const DEFAULT_RETRIES = Number(process.env.ZATCA_HTTP_RETRIES ?? 2)
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504])

export interface ZatcaHttpRequest {
  environment: ZatcaEnvironment
  endpoint: string
  url: string
  headers: Record<string, string>
  body: Record<string, unknown>
  invoiceId?: string | null
  timeoutMs?: number
  retries?: number
}

export interface ZatcaHttpResponse {
  status: number
  ok: boolean
  body: ZatcaApiResponseBody
  requestId: string
  correlationId: string
  durationMs: number
  warningCount: number
  errorCount: number
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function countMessages(body: ZatcaApiResponseBody, kind: 'warning' | 'error'): number {
  if (kind === 'warning') return body.validationResults?.warningMessages?.length ?? 0
  return (body.errors?.length ?? 0) + (body.validationResults?.errorMessages?.length ?? 0)
}

function responseMessage(body: ZatcaApiResponseBody): string | null {
  return body.errors?.[0]?.message
    ?? body.validationResults?.errorMessages?.[0]?.message
    ?? body.validationResults?.warningMessages?.[0]?.message
    ?? body.validationResults?.infoMessages?.[0]?.message
    ?? null
}

function extractRequestId(body: ZatcaApiResponseBody, headers: Headers): string {
  return body.requestID
    ?? body.requestId
    ?? body.request_id
    ?? headers.get('x-request-id')
    ?? headers.get('request-id')
    ?? headers.get('x-correlation-id')
    ?? headers.get('correlation-id')
    ?? ''
}

async function persistApiLog(input: {
  environment: ZatcaEnvironment
  endpoint: string
  invoiceId?: string | null
  status: number
  ok: boolean
  requestId: string
  correlationId: string
  durationMs: number
  errorMessage: string | null
  attempt: number
  warningCount: number
  errorCount: number
}) {
  try {
    const supabase = createAdminClient()
    const companyId = await getDefaultCompanyId(supabase)
    await supabase.from('zatca_api_logs').insert({
      company_id: companyId,
      environment: input.environment,
      endpoint: input.endpoint,
      http_method: 'POST',
      request_id: input.requestId || input.correlationId,
      response_code: String(input.status),
      success: input.ok,
      error_message: input.errorMessage,
      duration_ms: input.durationMs,
      invoice_id: input.invoiceId ?? null,
      metadata: {
        correlationId: input.correlationId,
        attempt: input.attempt,
        warningCount: input.warningCount,
        errorCount: input.errorCount,
      },
    })
  } catch {
    // API log persistence must never break invoice submission.
  }
}

export async function postZatcaJson(request: ZatcaHttpRequest): Promise<ZatcaHttpResponse> {
  const retries = request.retries ?? DEFAULT_RETRIES
  const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const correlationId = randomUUID()
  let lastError: unknown = null

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController()
    const startedAt = Date.now()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch(request.url, {
        method: 'POST',
        headers: {
          ...request.headers,
          'x-hisab-correlation-id': correlationId,
        },
        body: JSON.stringify(request.body),
        signal: controller.signal,
      })
      const body = (await response.json().catch(() => ({}))) as ZatcaApiResponseBody
      const durationMs = Date.now() - startedAt
      const warningCount = countMessages(body, 'warning')
      const errorCount = countMessages(body, 'error')
      const requestId = extractRequestId(body, response.headers)

      await persistApiLog({
        environment: request.environment,
        endpoint: request.endpoint,
        invoiceId: request.invoiceId,
        status: response.status,
        ok: response.ok,
        requestId,
        correlationId,
        durationMs,
        errorMessage: response.ok ? null : responseMessage(body),
        attempt,
        warningCount,
        errorCount,
      })

      if (response.ok || attempt >= retries || !RETRYABLE_STATUSES.has(response.status)) {
        return {
          status: response.status,
          ok: response.ok,
          body,
          requestId,
          correlationId,
          durationMs,
          warningCount,
          errorCount,
        }
      }
    } catch (error) {
      lastError = error
      const durationMs = Date.now() - startedAt
      await persistApiLog({
        environment: request.environment,
        endpoint: request.endpoint,
        invoiceId: request.invoiceId,
        status: 0,
        ok: false,
        requestId: '',
        correlationId,
        durationMs,
        errorMessage: error instanceof Error ? error.message : String(error),
        attempt,
        warningCount: 0,
        errorCount: 1,
      })
      if (attempt >= retries) break
    } finally {
      clearTimeout(timeout)
    }

    await delay(Math.min(1000 * 2 ** attempt, 5000))
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? 'ZATCA request failed'))
}

export function zatcaResponseMessage(body: ZatcaApiResponseBody, fallback: string): string {
  return responseMessage(body) ?? fallback
}
