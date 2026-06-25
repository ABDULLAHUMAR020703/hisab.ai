import 'server-only'
import { COMPANY_LOGO_MAX_BYTES } from './constants'
import { downloadCompanyLogoBuffer } from './storage'
import type { CompanyBranding } from './types'

async function loadLogoFromUrl(url: string): Promise<Buffer | null> {
  try {
    if (url.startsWith('data:')) {
      const match = url.match(/^data:image\/[\w+.-]+;base64,(.+)$/i)
      if (!match) return null
      const buf = Buffer.from(match[1], 'base64')
      return buf.length > 0 && buf.length <= COMPANY_LOGO_MAX_BYTES ? buf : null
    }

    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return null
    }

    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) {
      console.error('[branding] logo URL fetch failed:', res.status, url)
      return null
    }

    const contentType = res.headers.get('content-type') ?? ''
    if (contentType && !contentType.startsWith('image/')) {
      console.error('[branding] logo URL is not an image:', contentType)
      return null
    }

    const arrayBuffer = await res.arrayBuffer()
    const buf = Buffer.from(arrayBuffer)
    return buf.length > 0 && buf.length <= COMPANY_LOGO_MAX_BYTES ? buf : null
  } catch (error) {
    console.error('[branding] logo URL fetch error:', error)
    return null
  }
}

/**
 * Loads a company logo once for document rendering (PDF, future HTML exports).
 * Never throws — returns null when unavailable.
 */
export async function loadCompanyLogoImage(
  branding: Pick<CompanyBranding, 'logoStoragePath' | 'logoUrl'>,
): Promise<Buffer | null> {
  if (branding.logoStoragePath) {
    const fromStorage = await downloadCompanyLogoBuffer(branding.logoStoragePath)
    if (fromStorage) return fromStorage
  }

  if (branding.logoUrl) {
    return loadLogoFromUrl(branding.logoUrl)
  }

  return null
}
