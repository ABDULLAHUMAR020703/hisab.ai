import type { ParsedFile } from '../types'
import { FrameworkBadRequestError } from '../errors'

function parseCsvLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i += 1
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }

  result.push(current.trim())
  return result
}

export function findDuplicateHeaders(headers: string[]): string[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const header of headers) {
    const key = header.trim().toLowerCase()
    if (!key) continue
    if (seen.has(key)) duplicates.add(header)
    seen.add(key)
  }
  return [...duplicates]
}

export function parseCsv(text: string): ParsedFile {
  const normalized = text.replace(/^\uFEFF/, '').trim()
  const lines = normalized.split(/\r?\n/).filter((line) => line.trim().length > 0)

  if (lines.length < 1) {
    return { headers: [], rows: [], format: 'csv' }
  }

  const headers = parseCsvLine(lines[0]).map((h) => h.trim())
  const duplicateHeaders = findDuplicateHeaders(headers)
  if (duplicateHeaders.length > 0) {
    throw new FrameworkBadRequestError(
      `Duplicate column headers found: ${duplicateHeaders.join(', ')}`,
    )
  }
  const rows = lines.slice(1).map((line) => {
    const values = parseCsvLine(line)
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']))
  })

  return { headers, rows, format: 'csv' }
}

import { sanitizeExportCell } from '../security/sanitize-cell'

export function serializeCsv(
  headers: string[],
  rows: Array<Record<string, string | number | boolean | null>>,
): string {
  const escape = (value: string) => {
    const sanitized = sanitizeExportCell(value)
    if (/[",\n\r]/.test(sanitized)) {
      return `"${sanitized.replace(/"/g, '""')}"`
    }
    return sanitized
  }

  const lines = [
    headers.map(escape).join(','),
    ...rows.map((row) => headers.map((header) => escape(String(row[header] ?? ''))).join(',')),
  ]

  return lines.join('\n')
}
