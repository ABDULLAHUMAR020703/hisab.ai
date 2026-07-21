/**
 * Extract a human-readable reason from thrown values.
 * Never returns "[object Object]".
 */
export function extractErrorReason(error: unknown): string {
  if (error == null) return 'Unknown error'

  if (typeof error === 'string') {
    const trimmed = error.trim()
    return trimmed || 'Unknown error'
  }

  if (error instanceof Error) {
    const msg = error.message?.trim()
    if (msg && msg !== '[object Object]') return msg
  }

  if (typeof error === 'object') {
    const record = error as Record<string, unknown>

    // Supabase / PostgREST
    for (const key of ['message', 'error_description', 'error', 'details', 'hint', 'reason'] as const) {
      const value = record[key]
      if (typeof value === 'string' && value.trim() && value.trim() !== '[object Object]') {
        return value.trim()
      }
    }

    // Nested { error: { message } } or { data: { message } }
    for (const key of ['error', 'data', 'cause'] as const) {
      const nested = record[key]
      if (nested && typeof nested === 'object') {
        const nestedMsg = extractErrorReason(nested)
        if (nestedMsg && nestedMsg !== 'Unknown error') return nestedMsg
      }
    }

    // Postgres-style code + message
    if (typeof record.code === 'string' && typeof record.message === 'string') {
      return record.message.trim() || `Database error (${record.code})`
    }
  }

  try {
    const json = JSON.stringify(error)
    if (json && json !== '{}' && json !== 'null') {
      return json.length > 300 ? `${json.slice(0, 300)}…` : json
    }
  } catch {
    // ignore
  }

  return 'Unknown error'
}

export function humanizeImportFailure(
  kind: 'location' | 'class' | 'project',
  reason: string,
): string {
  const lower = reason.toLowerCase()

  // Code uniqueness failures are not the same as duplicate full names
  if (
    lower.includes('company_id_code') ||
    (lower.includes('unique') && lower.includes('code') && !lower.includes('name'))
  ) {
    return 'Duplicate cost center code — retry import or rename slightly'
  }

  if (
    lower.includes('duplicate') ||
    lower.includes('unique') ||
    lower.includes('already exists') ||
    lower.includes('23505')
  ) {
    if (kind === 'location') return 'Duplicate location name'
    if (kind === 'class') return 'Duplicate class name'
    return 'Duplicate project / product name'
  }

  if (lower.includes('too long') || lower.includes('character') || lower.includes('length')) {
    return reason
  }

  return reason
}
