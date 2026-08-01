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
}

interface DiagnosticContext {
  module?: string | null
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
  }, operation)
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
  if (!context) return globalThis.fetch(input, init)
  const details = requestDetails(input, init)
  const startedAt = performance.now()
  try {
    const response = await globalThis.fetch(input, init)
    context.onRequest({ ...details, module: context.module ?? null, durationMs: performance.now() - startedAt, status: response.status })
    return response
  } catch (error) {
    context.onRequest({ ...details, module: context.module ?? null, durationMs: performance.now() - startedAt, status: null })
    throw error
  }
}
