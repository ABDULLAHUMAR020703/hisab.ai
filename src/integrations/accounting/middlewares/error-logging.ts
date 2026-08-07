type ErrorRecord = Record<string, unknown>

const SENSITIVE_KEY = /(access.?token|refresh.?token|token|secret|password|credential|authorization|cookie|api.?key|client.?secret)/i

function asRecord(value: unknown): ErrorRecord | null {
  return typeof value === 'object' && value !== null ? value as ErrorRecord : null
}

function redactText(value: string): string {
  return value
    .replace(/\b(Bearer|Basic)\s+[^\s,;]+/gi, '$1 [REDACTED]')
    .replace(/((?:access.?token|refresh.?token|client.?secret|password|cookie|api.?key)["']?\s*[:=]\s*["']?)[^"'\s,;}]+/gi, '$1[REDACTED]')
}

function safeValue(value: unknown, key = '', depth = 0): unknown {
  if (SENSITIVE_KEY.test(key)) return '[REDACTED]'
  if (depth > 4) return '[TRUNCATED]'
  if (value === undefined || value === null) return value
  if (typeof value === 'string') return redactText(value)
  if (['number', 'boolean'].includes(typeof value)) return value
  if (Array.isArray(value)) return value.map((item) => safeValue(item, '', depth + 1))
  const record = asRecord(value)
  if (!record) return String(value)
  return Object.fromEntries(
    Object.entries(record).map(([entryKey, entryValue]) => [entryKey, safeValue(entryValue, entryKey, depth + 1)]),
  )
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function postgrestBody(record: ErrorRecord, message: string): unknown {
  if (record.postgrestErrorBody !== undefined) return safeValue(record.postgrestErrorBody)
  if (record.body !== undefined) {
    if (typeof record.body === 'string') {
      try {
        return safeValue(JSON.parse(record.body))
      } catch {
        return safeValue(record.body)
      }
    }
    return safeValue(record.body)
  }
  if (record.code !== undefined || record.details !== undefined || record.hint !== undefined) {
    return safeValue({ message, details: record.details, hint: record.hint, code: record.code })
  }
  return undefined
}

export interface IntegrationErrorLogContext {
  error: string
  errorMessage: string
  errorStack?: string
  databaseErrorCode?: string
  postgrestErrorBody?: unknown
  supabaseErrorDetails?: unknown
  supabaseErrorHint?: unknown
  supabaseErrorCode?: string
}

export function integrationErrorLogContext(error: unknown): IntegrationErrorLogContext {
  const record = asRecord(error) ?? {}
  const message = error instanceof Error
    ? error.message
    : text(record.message) ?? (typeof error === 'string' ? error : 'Unknown non-Error exception')
  const safeMessage = redactText(message)
  const stack = safeValue(error instanceof Error ? error.stack : text(record.stack), 'stack') as string | undefined
  const code = text(record.code)

  return {
    error: safeMessage,
    errorMessage: safeMessage,
    errorStack: stack,
    databaseErrorCode: code,
    postgrestErrorBody: postgrestBody(record, safeMessage),
    supabaseErrorDetails: safeValue(record.details, 'details'),
    supabaseErrorHint: safeValue(record.hint, 'hint'),
    supabaseErrorCode: code,
  }
}
