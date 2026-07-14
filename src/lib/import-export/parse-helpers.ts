export function parseBooleanField(value: unknown, defaultValue = true): boolean {
  if (typeof value === 'boolean') return value
  if (value === undefined || value === null || value === '') return defaultValue
  const lower = String(value).trim().toLowerCase()
  if (['false', 'no', 'n', '0', 'inactive'].includes(lower)) return false
  if (['true', 'yes', 'y', '1', 'active'].includes(lower)) return true
  return defaultValue
}

export function parseOptionalString(value: unknown): string | null {
  if (value === undefined || value === null) return null
  const trimmed = String(value).trim()
  return trimmed || null
}

export function parseNumberField(value: unknown, defaultValue = 0): number {
  if (value === undefined || value === null || value === '') return defaultValue
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const normalized = String(value).replace(/,/g, '').trim()
  const num = Number(normalized)
  return Number.isFinite(num) ? num : defaultValue
}

export function parseDateField(value: unknown): Date | null {
  if (value === undefined || value === null || value === '') return null
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value
  const parsed = new Date(String(value))
  return Number.isNaN(parsed.getTime()) ? null : parsed
}
