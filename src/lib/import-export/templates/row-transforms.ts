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
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
}
