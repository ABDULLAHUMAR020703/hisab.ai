/**
 * Shared detection for Excel print/footer metadata and timestamps.
 * Used by Location, Class, and Project Cost Center importers.
 */

const WEEKDAYS =
  /\b(mon(day)?|tue(sday)?|wed(nesday)?|thu(rsday)?|fri(day)?|sat(urday)?|sun(day)?)\b/i

const MONTHS =
  /\b(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|jun(e)?|jul(y)?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?)\b/i

const TIMEZONES =
  /\b(gmtz?|utc|est|edt|cst|cdt|mst|mdt|pst|pdt|bst|cet|cest|[+-]\d{2}:?\d{2})\b/i

const FOOTER_KEYWORDS =
  /\b(printed(\s+on)?|generated(\s+by)?|exported(\s+by)?|created\s+by|microsoft\s+excel|page\s+\d+(\s+of\s+\d+)?|confidential|end\s+of\s+(report|list|file)|print\s+date|report\s+date)\b/i

/** Thursday, July 02, 2026 02:41 PM GMTZ (flexible punctuation/spacing) */
const LONG_DATE_TIME =
  /\b(mon(day)?|tue(sday)?|wed(nesday)?|thu(rsday)?|fri(day)?|sat(urday)?|sun(day)?)\b[\s,.-]+\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b[\s,.-]*\d{1,2}[\s,.-]+\d{2,4}[\s,.-]+\d{1,2}:\d{2}/i

const DATE_ONLY =
  /^(\d{1,2}[\/\-.\s]\d{1,2}[\/\-.\s]\d{2,4}|\d{4}[\/\-.\s]\d{1,2}[\/\-.\s]\d{1,2}|\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{2,4})$/i

const TIME_ONLY = /^\d{1,2}:\d{2}(:\d{2})?(\s*[ap]\.?m\.?)?$/i

const ISO_DATE_TIME =
  /^\d{4}-\d{2}-\d{2}([t\s]\d{2}:\d{2}(:\d{2})?(\.\d+)?(z|[+-]\d{2}:?\d{2})?)?$/i

/** Normalize whitespace / NBSP so footer matching is reliable. */
export function normalizeImportCellText(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString()
  }
  return String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/[\u2000-\u200b\ufeff]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * True when a cell is Excel print/footer metadata or a timestamp — never import as master data.
 */
export function isExcelFooterOrMetadata(value: unknown): boolean {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return true
  }

  // Excel serial date numbers (roughly 1982–2064)
  if (typeof value === 'number' && Number.isFinite(value) && value >= 30000 && value <= 60000) {
    return true
  }

  const text = normalizeImportCellText(value)
  if (!text) return false

  const lower = text.toLowerCase()

  if (FOOTER_KEYWORDS.test(text)) return true
  if (LONG_DATE_TIME.test(text)) return true
  if (DATE_ONLY.test(text)) return true
  if (TIME_ONLY.test(text)) return true
  if (ISO_DATE_TIME.test(text)) return true

  // Weekday + month + year (covers format variants)
  if (WEEKDAYS.test(text) && MONTHS.test(text) && /\b(19|20)\d{2}\b/.test(text)) {
    return true
  }

  // Weekday + numeric date + time (e.g. Thursday 07/02/2026 2:41 PM)
  if (WEEKDAYS.test(text) && /\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(text)) {
    return true
  }

  // Timezone marker with year or clock time
  if (TIMEZONES.test(text) && (/\b(19|20)\d{2}\b/.test(text) || /\d{1,2}:\d{2}/.test(text))) {
    return true
  }

  if (/^page\s+\d+/i.test(text)) return true

  // Slug-like residue of a weekday timestamp (defensive)
  if (/^(thu(rsday)?|mon(day)?|tue(sday)?|wed(nesday)?|fri(day)?|sat(urday)?|sun(day)?)[-_\s]+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(text)) {
    return true
  }

  // "PM GMTZ" / "AM UTC" style clock footers without requiring weekday
  if (/\b\d{1,2}:\d{2}(:\d{2})?\s*([ap]\.?m\.?)?\s*(gmtz?|utc)\b/i.test(text) && /\b(19|20)\d{2}\b/.test(text)) {
    return true
  }

  // Entire cell is only timezone word
  if (/^(gmtz?|utc)$/i.test(lower)) return true

  return false
}

export type VerticalRowKind =
  | 'empty'
  | 'company_header'
  | 'list_title'
  | 'column_header'
  | 'footer_metadata'
  | 'data'

export interface ClassifyVerticalRowOptions {
  companyHeaderPlaceholder?: string
  listTitles?: string[]
  columnHeaders?: string[]
  /** Once true, company-name heuristics are not applied (avoids skipping real Class names). */
  seenData?: boolean
}

/**
 * Classify a vertical-list cell (Location / Class templates).
 * Shared by Location and Class importers.
 */
export function classifyVerticalImportRow(
  value: unknown,
  options: ClassifyVerticalRowOptions = {},
): VerticalRowKind {
  const text = normalizeImportCellText(value)
  if (!text) return 'empty'

  if (isExcelFooterOrMetadata(value) || isExcelFooterOrMetadata(text)) {
    return 'footer_metadata'
  }

  const lower = text.toLowerCase()
  const listTitles = (options.listTitles ?? ['location list', 'class list']).map((s) => s.toLowerCase())
  const columnHeaders = (options.columnHeaders ?? [
    'location full name',
    'class full name',
  ]).map((s) => s.toLowerCase())

  if (listTitles.includes(lower)) return 'list_title'
  if (columnHeaders.includes(lower)) return 'column_header'

  // Company title only in the preamble — never after real data rows start.
  if (!options.seenData) {
    const placeholder = (options.companyHeaderPlaceholder ?? 'YOUR COMPANY NAME').toLowerCase()
    if (
      lower === placeholder ||
      /\bcompany\b|\bllc\b|\bltd\b|\binc\b|\bcorp\b/i.test(text)
    ) {
      return 'company_header'
    }
  }

  return 'data'
}

/**
 * Whether this row should stop the vertical import (footer after data started).
 */
export function shouldStopVerticalImport(kind: VerticalRowKind, seenData: boolean): boolean {
  return seenData && kind === 'footer_metadata'
}

/**
 * Whether this row should be skipped (not imported) without stopping.
 */
export function shouldSkipVerticalImportRow(kind: VerticalRowKind): boolean {
  return (
    kind === 'empty' ||
    kind === 'company_header' ||
    kind === 'list_title' ||
    kind === 'column_header' ||
    kind === 'footer_metadata'
  )
}
