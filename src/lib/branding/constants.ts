export const COMPANY_BRANDING_BUCKET = 'company-files'

/** 5 MB — matches upload validation and storage bucket limit. */
export const COMPANY_LOGO_MAX_BYTES = 5 * 1024 * 1024

export const COMPANY_LOGO_ALLOWED_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/svg+xml',
] as const

export const COMPANY_LOGO_ALLOWED_EXTENSIONS = ['png', 'jpg', 'jpeg', 'svg'] as const

/** PDF header layout — shared across document templates. */
export const COMPANY_LOGO_PDF_MAX_WIDTH = 120
export const COMPANY_LOGO_PDF_MAX_HEIGHT = 68
export const COMPANY_LOGO_PDF_GAP = 14
