import type { FileFormat } from '../types'

export function detectFormatFromFilename(filename: string): FileFormat | null {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.csv')) return 'csv'
  if (lower.endsWith('.xlsx')) return 'xlsx'
  if (lower.endsWith('.xls')) return null
  return null
}

export function detectFormatFromMime(mime: string): FileFormat | null {
  const lower = mime.toLowerCase()
  if (lower.includes('csv') || lower === 'text/plain') return 'csv'
  if (
    lower.includes('spreadsheet') ||
    lower.includes('excel') ||
    lower === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ) {
    return 'xlsx'
  }
  return null
}
