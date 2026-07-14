const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  'metadata.google.internal',
])

function isPrivateIpv4(host: string): boolean {
  const parts = host.split('.').map(Number)
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return false
  const [a, b] = parts
  if (a === 10) return true
  if (a === 127) return true
  if (a === 0) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  return false
}

export function isSafeWebhookUrl(urlString: string): { ok: true } | { ok: false; reason: string } {
  let parsed: URL
  try {
    parsed = new URL(urlString)
  } catch {
    return { ok: false, reason: 'Invalid URL' }
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { ok: false, reason: 'Only HTTP(S) URLs are allowed' }
  }

  const host = parsed.hostname.toLowerCase()
  if (BLOCKED_HOSTNAMES.has(host)) {
    return { ok: false, reason: 'Blocked hostname' }
  }

  if (host.endsWith('.local') || host.endsWith('.internal')) {
    return { ok: false, reason: 'Blocked internal domain' }
  }

  if (isPrivateIpv4(host)) {
    return { ok: false, reason: 'Private IP addresses are not allowed' }
  }

  return { ok: true }
}
