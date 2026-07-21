import * as XLSX from 'xlsx'
import {
  CLASS_COLUMN_HEADER,
  CLASS_LIST_TITLE,
  COMPANY_HEADER_PLACEHOLDER,
  LOCATION_COLUMN_HEADER,
  LOCATION_LIST_TITLE,
  PROJECT_PRODUCT_SERVICE_HEADERS,
} from './constants'
import {
  classifyVerticalImportRow,
  isExcelFooterOrMetadata,
  normalizeImportCellText,
  shouldSkipVerticalImportRow,
  shouldStopVerticalImport,
} from './footer-metadata'

export type CostCenterImportKind = 'location' | 'class' | 'project'

export interface VerticalImportRow {
  rowNumber: number
  name: string
}

export interface ProjectImportRow {
  rowNumber: number
  name: string
  /** Full original column map for metadata storage. */
  fields: Record<string, string>
}

export interface VerticalParseResult {
  kind: 'location' | 'class'
  rows: VerticalImportRow[]
  skippedEmpty: number
}

export interface ProjectParseResult {
  kind: 'project'
  rows: ProjectImportRow[]
  skippedEmpty: number
  headers: string[]
}

function readSheetMatrix(buffer: ArrayBuffer): (string | number | boolean | Date | null)[][] {
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true })
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) return []
  const sheet = workbook.Sheets[sheetName]
  return XLSX.utils.sheet_to_json<(string | number | boolean | Date | null)[]>(sheet, {
    header: 1,
    raw: false,
    defval: '',
  })
}

function cellText(value: unknown): string {
  return normalizeImportCellText(value)
}

/**
 * Parse Location List or Class List vertical spreadsheets.
 * Shared header/footer skipping via classifyVerticalImportRow.
 */
export function parseVerticalListSheet(
  buffer: ArrayBuffer,
  kind: 'location' | 'class',
): VerticalParseResult {
  const matrix = readSheetMatrix(buffer)
  const rows: VerticalImportRow[] = []
  let skippedEmpty = 0
  let seenData = false

  const classifyOptions =
    kind === 'location'
      ? {
          companyHeaderPlaceholder: COMPANY_HEADER_PLACEHOLDER,
          listTitles: [LOCATION_LIST_TITLE, 'Location List'],
          columnHeaders: [LOCATION_COLUMN_HEADER, 'Location full name'],
        }
      : {
          companyHeaderPlaceholder: COMPANY_HEADER_PLACEHOLDER,
          listTitles: [CLASS_LIST_TITLE, 'Class List'],
          columnHeaders: [CLASS_COLUMN_HEADER, 'Class full name'],
        }

  for (let i = 0; i < matrix.length; i++) {
    const rawCell = matrix[i]?.[0]
    const rowKind = classifyVerticalImportRow(rawCell, {
      ...classifyOptions,
      seenData,
    })

    if (rowKind === 'empty') {
      skippedEmpty++
      continue
    }

    if (shouldStopVerticalImport(rowKind, seenData)) {
      break
    }

    if (shouldSkipVerticalImportRow(rowKind)) {
      continue
    }

    const name = cellText(rawCell)
    // Extra guard: never treat footer text as data even if classifier missed a variant
    if (!name || isExcelFooterOrMetadata(name)) {
      if (seenData) break
      continue
    }

    seenData = true
    rows.push({ rowNumber: i + 1, name })
  }

  return { kind, rows, skippedEmpty }
}

/**
 * Parse Product/Service horizontal spreadsheet.
 * First row = exact headers; subsequent rows = projects.
 * Company title rows (no Product/Service Name header) are skipped by finding the header row.
 */
export function parseProjectProductServiceSheet(buffer: ArrayBuffer): ProjectParseResult {
  const matrix = readSheetMatrix(buffer)
  if (matrix.length === 0) {
    return { kind: 'project', rows: [], skippedEmpty: 0, headers: [...PROJECT_PRODUCT_SERVICE_HEADERS] }
  }

  let headerRowIndex = -1
  let headers: string[] = []

  for (let i = 0; i < Math.min(matrix.length, 10); i++) {
    const row = (matrix[i] ?? []).map(cellText)
    const joined = row.map((h) => h.toLowerCase())
    const hasName =
      joined.includes('product/service name') ||
      joined.includes('product / service name') ||
      joined.includes('product/service')
    if (hasName || row.some((h) => PROJECT_PRODUCT_SERVICE_HEADERS.includes(h as typeof PROJECT_PRODUCT_SERVICE_HEADERS[number]))) {
      headerRowIndex = i
      headers = row
      break
    }
  }

  if (headerRowIndex < 0) {
    // Fallback: assume first row is headers if it has multiple columns
    const first = (matrix[0] ?? []).map(cellText)
    if (first.filter(Boolean).length >= 2) {
      headerRowIndex = 0
      headers = first
    } else {
      return { kind: 'project', rows: [], skippedEmpty: 0, headers: [...PROJECT_PRODUCT_SERVICE_HEADERS] }
    }
  }

  const nameHeader =
    headers.find((h) => /^product\s*\/\s*service\s*name$/i.test(h)) ||
    headers.find((h) => /product\/service/i.test(h)) ||
    headers[0]

  const rows: ProjectImportRow[] = []
  let skippedEmpty = 0
  let seenData = false

  for (let i = headerRowIndex + 1; i < matrix.length; i++) {
    const cells = matrix[i] ?? []
    const fields: Record<string, string> = {}
    headers.forEach((header, idx) => {
      if (!header) return
      fields[header] = cellText(cells[idx])
    })

    const name = (fields[nameHeader] ?? '').trim()
    const anyValue = Object.values(fields).some((v) => v.trim() !== '')
    if (!anyValue) {
      skippedEmpty++
      continue
    }

    const primaryCell = cells[headers.indexOf(nameHeader)] ?? cells[0]
    if (isExcelFooterOrMetadata(primaryCell ?? name) || isExcelFooterOrMetadata(name)) {
      if (seenData) break
      skippedEmpty++
      continue
    }

    if (!name) {
      skippedEmpty++
      continue
    }

    const nonEmpty = Object.values(fields).filter((v) => v.trim())
    if (nonEmpty.length === 1 && isExcelFooterOrMetadata(nonEmpty[0])) {
      if (seenData) break
      skippedEmpty++
      continue
    }

    seenData = true
    rows.push({ rowNumber: i + 1, name, fields })
  }

  return { kind: 'project', rows, skippedEmpty, headers }
}

/** Build Location List template matching client vertical layout. */
export function buildLocationTemplateSheet(companyName = COMPANY_HEADER_PLACEHOLDER): ArrayBuffer {
  const data = [
    [companyName],
    [LOCATION_LIST_TITLE],
    [LOCATION_COLUMN_HEADER],
    ['Afif'],
    ['Dammam'],
    ['East Region'],
  ]
  return aoaToXlsx(data, 'Location List')
}

/** Build Class List template matching client vertical layout. */
export function buildClassTemplateSheet(companyName = COMPANY_HEADER_PLACEHOLDER): ArrayBuffer {
  const data = [
    [companyName],
    [CLASS_LIST_TITLE],
    [CLASS_COLUMN_HEADER],
    ['ADMINISTRATION'],
    ['ADMINISTRATION:Office Expense'],
    ['Aramco WPR Project'],
  ]
  return aoaToXlsx(data, 'Class List')
}

/** Build Product/Service template with exact headers (horizontal). */
export function buildProjectTemplateSheet(companyName = COMPANY_HEADER_PLACEHOLDER): ArrayBuffer {
  const headers = [...PROJECT_PRODUCT_SERVICE_HEADERS]
  const example = [
    '12PCS SPANNER SET',
    '10',
    'Inventory',
    'Tools',
    'SKU-001',
    'No',
    'Yes',
    '150',
    '100',
    '4100 Sales Revenue',
    '5000 Cost of Goods Sold',
    '1500 Inventory Asset',
    '12 piece spanner set',
    'Procurement description',
    '5',
    'Preferred Supplier LLC',
  ]
  const data = [[companyName], headers, example]
  return aoaToXlsx(data, 'Product Service')
}

function aoaToXlsx(data: (string | number)[][], sheetName: string): ArrayBuffer {
  const sheet = XLSX.utils.aoa_to_sheet(data)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName.slice(0, 31))
  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}

export function parseCsvTextAsBuffer(text: string): ArrayBuffer {
  const workbook = XLSX.read(text, { type: 'string', raw: false })
  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}
