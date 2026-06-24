import 'server-only'

const MAX_LOGO_BYTES = 2 * 1024 * 1024

/**
 * Loads a company logo for PDF embedding. Supports data URLs and remote http(s) URLs.
 * Returns null when missing or unreadable — callers fall back to a text header.
 */
export async function loadCompanyLogoPng(logoUrl: string | null | undefined): Promise<Buffer | null> {
  const url = logoUrl?.trim()
  if (!url) return null

  try {
    if (url.startsWith('data:')) {
      const match = url.match(/^data:image\/[\w+.-]+;base64,(.+)$/i)
      if (!match) return null
      const buf = Buffer.from(match[1], 'base64')
      return buf.length > 0 && buf.length <= MAX_LOGO_BYTES ? buf : null
    }

    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return null
    }

    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return null
    const contentType = res.headers.get('content-type') ?? ''
    if (contentType && !contentType.startsWith('image/')) return null
    const arrayBuffer = await res.arrayBuffer()
    const buf = Buffer.from(arrayBuffer)
    return buf.length > 0 && buf.length <= MAX_LOGO_BYTES ? buf : null
  } catch {
    return null
  }
}
