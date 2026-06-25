import {
  COMPANY_LOGO_ALLOWED_EXTENSIONS,
  COMPANY_LOGO_ALLOWED_MIME_TYPES,
  COMPANY_LOGO_MAX_BYTES,
} from './constants'

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/svg+xml': 'svg',
}

export function validateCompanyLogoFile(file: File): string | null {
  if (file.size <= 0) return 'Logo file is empty.'
  if (file.size > COMPANY_LOGO_MAX_BYTES) {
    return `Logo must be ${COMPANY_LOGO_MAX_BYTES / (1024 * 1024)} MB or smaller.`
  }

  const mime = file.type.toLowerCase()
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''

  const mimeOk = (COMPANY_LOGO_ALLOWED_MIME_TYPES as readonly string[]).includes(mime)
  const extOk = (COMPANY_LOGO_ALLOWED_EXTENSIONS as readonly string[]).includes(extension)

  if (!mimeOk && !extOk) {
    return 'Logo must be PNG, JPG, JPEG, or SVG.'
  }

  return null
}

export function inferLogoMimeType(file: File): string {
  const mime = file.type.toLowerCase()
  if (mime && mime in EXTENSION_BY_MIME) return mime
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (extension === 'png') return 'image/png'
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
  if (extension === 'svg') return 'image/svg+xml'
  return mime || 'application/octet-stream'
}

export function isSvgMime(mime: string): boolean {
  return mime === 'image/svg+xml'
}
