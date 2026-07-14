interface CacheEntry<T> {
  value: T
  expiresAt: number
}

const cache = new Map<string, CacheEntry<unknown>>()
const DEFAULT_TTL_MS = 60_000

export function getCachedReport<T>(key: string): T | null {
  const entry = cache.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    cache.delete(key)
    return null
  }
  return entry.value as T
}

export function setCachedReport<T>(key: string, value: T, ttlMs = DEFAULT_TTL_MS): void {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs })
}

export function buildReportCacheKey(
  report: string,
  companyId: string,
  params: Record<string, string | undefined>,
): string {
  const sorted = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k] ?? ''}`)
    .join('&')
  return `${report}:${companyId}:${sorted}`
}

export function invalidateReportCache(companyId: string): void {
  for (const key of cache.keys()) {
    if (key.includes(`:${companyId}:`)) cache.delete(key)
  }
}
