import { createHash, randomBytes } from 'crypto'

export function generateApiKey(): { raw: string; prefix: string; hash: string } {
  const raw = `hsk_${randomBytes(24).toString('hex')}`
  const prefix = raw.substring(0, 12)
  const hash = createHash('sha256').update(raw).digest('hex')
  return { raw, prefix, hash }
}

const rateBuckets = new Map<string, { count: number; resetAt: number }>()

export function checkRateLimit(keyId: string, limitPerMinute: number): boolean {
  const now = Date.now()
  const bucket = rateBuckets.get(keyId)
  if (!bucket || now > bucket.resetAt) {
    rateBuckets.set(keyId, { count: 1, resetAt: now + 60_000 })
    return true
  }
  if (bucket.count >= limitPerMinute) return false
  bucket.count += 1
  return true
}

export function hasScope(scopes: string[], required: string): boolean {
  return scopes.includes('*') || scopes.includes(required)
}

export function hashApiKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex')
}
