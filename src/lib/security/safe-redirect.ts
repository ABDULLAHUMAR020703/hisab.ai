const SAFE_PATH = /^\/[a-zA-Z0-9/_\-.]*$/

export function sanitizeRedirectPath(next: string | null | undefined, fallback = '/'): string {
  if (!next || typeof next !== 'string') return fallback
  const trimmed = next.trim()
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return fallback
  if (trimmed.includes('://') || trimmed.includes('\\')) return fallback
  if (!SAFE_PATH.test(trimmed)) return fallback
  return trimmed
}
