const processedKeys = new Map<string, number>()
const TTL_MS = 24 * 60 * 60 * 1000

function purgeExpired(now: number) {
  for (const [key, expiresAt] of processedKeys.entries()) {
    if (expiresAt <= now) processedKeys.delete(key)
  }
}

export function buildIdempotencyKey(companyId: string, scope: string, key: string): string {
  return `${companyId}:${scope}:${key}`
}

export function claimIdempotencyKey(key: string): boolean {
  const now = Date.now()
  purgeExpired(now)
  if (processedKeys.has(key)) return false
  processedKeys.set(key, now + TTL_MS)
  return true
}

export function releaseIdempotencyKey(key: string) {
  processedKeys.delete(key)
}
