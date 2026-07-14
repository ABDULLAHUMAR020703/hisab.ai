export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
  'text/plain',
  'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
])

const BLOCKED_EXTENSIONS = new Set([
  'html', 'htm', 'js', 'mjs', 'jsx', 'ts', 'tsx', 'svg', 'exe', 'bat', 'cmd', 'sh', 'php', 'asp', 'aspx',
])

export function sanitizeDocumentFileName(originalName: string): string {
  const base = originalName.split(/[/\\]/).pop() ?? 'file'
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '')
  return cleaned.length > 0 ? cleaned : 'file'
}

export function buildSafeStorageFileName(originalName: string): string {
  const safe = sanitizeDocumentFileName(originalName)
  const ext = safe.includes('.') ? safe.split('.').pop()?.toLowerCase() ?? 'bin' : 'bin'
  if (BLOCKED_EXTENSIONS.has(ext)) {
    return `${Date.now()}-upload.bin`
  }
  return `${Date.now()}-${safe}`
}

export function validateDocumentUpload(file: File): string | null {
  if (file.size <= 0) return 'File is empty'
  if (file.size > DOCUMENT_MAX_BYTES) return `File exceeds ${DOCUMENT_MAX_BYTES / (1024 * 1024)} MB limit`

  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (BLOCKED_EXTENSIONS.has(ext)) return `File type .${ext} is not allowed`

  const mime = (file.type || 'application/octet-stream').toLowerCase()
  if (!ALLOWED_MIME_TYPES.has(mime)) {
    return 'Unsupported file type'
  }

  return null
}
