/** Shared transforms for official template rows (server-only). */

export function deriveAccountNameFromFullName(fullName: string): string {
  const trimmed = fullName.trim()
  if (!trimmed) return ''
  const parts = trimmed.split(':')
  return parts[parts.length - 1]?.trim() ?? trimmed
}

export function deriveParentAccountNo(accountNo: string): string | null {
  const trimmed = accountNo.trim()
  const lastDash = trimmed.lastIndexOf('-')
  if (lastDash <= 0) return null
  return trimmed.slice(0, lastDash)
}

export function parseClassFullName(classFullName: string): {
  name: string
  description: string | null
} {
  const trimmed = classFullName.trim()
  if (!trimmed) return { name: '', description: null }
  const parts = trimmed.split(':').map((part) => part.trim()).filter(Boolean)
  if (parts.length <= 1) {
    return { name: trimmed, description: null }
  }
  return {
    name: parts[parts.length - 1]!,
    description: parts.slice(0, -1).join(' > '),
  }
}

export function slugifyCode(value: string): string {
  const trimmed = value.trim()
  const slug = trimmed
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  // Fingerprint full value so long shared prefixes (Parent:Child A vs B) stay unique
  let hash = 2166136261
  const input = trimmed.toLowerCase()
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  const fingerprint = (hash >>> 0).toString(36).toUpperCase().padStart(6, '0').slice(0, 6)
  const stem = (slug || 'ITEM').slice(0, 40)
  return `${stem}-${fingerprint}`
}
