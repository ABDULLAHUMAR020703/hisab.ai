/** Preserve SQLite ISO timestamps for created_at ordering (ZATCA hash chain) */
export function toTimestamptz(value: unknown): string | null {
  if (value == null || value === '') return null
  if (value instanceof Date) return value.toISOString()
  const s = String(value)
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(s) ? s : `${s}Z`
  if (/^\d{4}-\d{2}-\d{2} /.test(s)) return `${s.replace(' ', 'T')}Z`
  const n = Number(s)
  if (!Number.isNaN(n) && n > 1e11) return new Date(n).toISOString()
  return s
}

export function toNumeric(value: unknown): string {
  if (value == null || value === '') return '0'
  const n = Number(value)
  if (Number.isNaN(n)) throw new Error(`Invalid numeric value: ${value}`)
  return n.toFixed(4)
}

export function toBool(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (value === 1 || value === '1' || value === 'true') return true
  return false
}

export function toInt(value: unknown): number {
  return Math.trunc(Number(value))
}

/** Parse Prisma JSON string fields into objects for JSONB columns */
export function parseJsonField(value: unknown, fieldLabel: string): unknown | null {
  if (value == null || value === '') return null
  if (typeof value === 'object') return value
  const raw = String(value)
  try {
    return JSON.parse(raw)
  } catch (err) {
    throw new Error(`Failed to parse JSON for ${fieldLabel}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/** Copy encrypted / hash / UUID fields byte-for-byte (no transform) */
export function verbatim(value: unknown): string | null {
  if (value == null) return null
  return String(value)
}

/** JSONB: parse JSON strings; optionally wrap plain strings (e.g. cleared invoice base64) */
export function toJsonb(value: unknown, fieldLabel: string, allowPlainString = false): string | null {
  if (value == null || value === '') return null
  if (typeof value === 'object') return JSON.stringify(value)
  const raw = String(value)
  try {
    return JSON.stringify(parseJsonField(raw, fieldLabel))
  } catch {
    if (allowPlainString) return JSON.stringify(raw)
    throw new Error(`Failed to parse JSON for ${fieldLabel}`)
  }
}
