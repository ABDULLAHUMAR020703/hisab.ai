import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash } from 'node:crypto'

export type ExternalRequestKind = 'quickbooks' | 'supabase' | 'external'

export interface ExternalRequestEvent {
  kind: ExternalRequestKind
  module: string | null
  method: string
  endpoint: string
  signature: string
  durationMs: number
  status: number | null
  attempt?: number
  correlationId?: string | null
  error?: { name: string; message: string; code: string | null; causeCode: string | null } | null
}

interface DiagnosticContext {
  module?: string | null
  correlationId?: string | null
  onRequest: (event: ExternalRequestEvent) => void
}

const diagnostics = new AsyncLocalStorage<DiagnosticContext>()

export function withExternalRequestDiagnostics<T>(
  context: Partial<DiagnosticContext> & Pick<DiagnosticContext, 'onRequest'>,
  operation: () => T,
): T {
  const parent = diagnostics.getStore()
  return diagnostics.run({
    onRequest: context.onRequest ?? parent?.onRequest ?? (() => undefined),
    module: context.module === undefined ? parent?.module ?? null : context.module,
    correlationId: context.correlationId === undefined ? parent?.correlationId ?? null : context.correlationId,
  }, operation)
}

function errorDetails(error: unknown): ExternalRequestEvent['error'] {
  const current = error !== null && typeof error === 'object' ? error as Record<string, unknown> : {}
  const cause = current.cause !== null && typeof current.cause === 'object' ? current.cause as Record<string, unknown> : {}
  return {
    name: error instanceof Error ? error.name : 'Error',
    message: error instanceof Error ? error.message : String(error),
    code: typeof current.code === 'string' ? current.code : null,
    causeCode: typeof cause.code === 'string' ? cause.code : null,
  }
}

function headerValue(headers: HeadersInit | undefined, key: string): string {
  return new Headers(headers).get(key) ?? ''
}

function isRetrySafe(method: string, init?: RequestInit): boolean {
  if (['GET', 'HEAD', 'OPTIONS', 'PUT', 'PATCH', 'DELETE'].includes(method)) return true
  return method === 'POST' && headerValue(init?.headers, 'prefer').toLowerCase().includes('resolution=merge-duplicates')
}

function retryDelay(attempt: number): number {
  return Math.min(250 * 2 ** (attempt - 1), 2_000)
}

async function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw signal.reason
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    const abort = () => { clearTimeout(timer); reject(signal?.reason) }
    signal?.addEventListener('abort', abort, { once: true })
  })
}

function requestDetails(input: RequestInfo | URL, init?: RequestInit) {
  const raw = input instanceof Request ? input.url : input.toString()
  const url = new URL(raw)
  const method = String(init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
  const kind: ExternalRequestKind = url.hostname.endsWith('.intuit.com')
    ? 'quickbooks'
    : url.hostname.endsWith('.supabase.co') || url.hostname.includes('.pooler.supabase.com')
      ? 'supabase'
      : 'external'
  const canonical = `${method} ${url.hostname}${url.pathname}?${[...url.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('&')}`
  return {
    kind,
    method,
    endpoint: `${url.hostname}${url.pathname}`,
    signature: createHash('sha256').update(canonical).digest('hex').slice(0, 16),
  }
}

/** Fetch wrapper used by server-side Supabase and QuickBooks clients. */
export async function diagnosticFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const context = diagnostics.getStore()
  const details = requestDetails(input, init)
  const maxAttempts = details.kind === 'supabase' && isRetrySafe(details.method, init) ? 3 : 1
  let lastError: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const startedAt = performance.now()
    const timeout = AbortSignal.timeout(details.kind === 'supabase' ? 30_000 : 60_000)
    const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout
    try {
      const response = await globalThis.fetch(input, { ...init, signal })
      context?.onRequest({ ...details, module: context.module ?? null, durationMs: performance.now() - startedAt, status: response.status, attempt, correlationId: context.correlationId ?? null, error: null })
      if (attempt < maxAttempts && (response.status === 429 || response.status >= 500)) {
        await abortableDelay(retryDelay(attempt), init?.signal ?? undefined)
        continue
      }
      return response
    } catch (error) {
      lastError = error
      context?.onRequest({ ...details, module: context.module ?? null, durationMs: performance.now() - startedAt, status: null, attempt, correlationId: context.correlationId ?? null, error: errorDetails(error) })
      if (attempt >= maxAttempts || init?.signal?.aborted) throw error
      await abortableDelay(retryDelay(attempt), init?.signal ?? undefined)
    }
  }
  throw lastError
}
