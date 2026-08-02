export type FileFormat = 'csv' | 'xlsx'

export type DuplicateStrategy = 'skip' | 'update' | 'create'

export type ImportJobStatus =
  | 'pending'
  | 'parsing'
  | 'mapping'
  | 'validating'
  | 'processing'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type FieldType =
  | 'string'
  | 'email'
  | 'phone'
  | 'number'
  | 'date'
  | 'boolean'
  | 'currency'
  | 'vat'

export type ValidationSeverity = 'error' | 'warning'

export interface FieldDefinition {
  key: string
  label: string
  type: FieldType
  required?: boolean
  importable?: boolean
  exportable?: boolean
  exportOrder?: number
  description?: string
}

/** Column in a hisab.ai official import template (QuickBooks-style). */
export interface OfficialTemplateColumn {
  /** Exact header text in the downloadable template file. */
  header: string
  /** Internal field key used after mapping. */
  fieldKey: string
  required?: boolean
  /** Example value shown in the downloadable template row. */
  example: string
}

/** Module-defined official import template — headers match skips manual mapping. */
export interface OfficialImportTemplate {
  id: string
  name: string
  columns: OfficialTemplateColumn[]
}

export interface ModuleDefinition {
  key: string
  displayName: string
  fields: FieldDefinition[]
  duplicateKeys: string[]
  /** Official hisab.ai import templates for this module. */
  officialTemplates?: OfficialImportTemplate[]
  /**
   * Normalize mapped rows from an official template into internal field shape.
   * Called after column mapping when officialTemplateId is set.
   */
  transformOfficialRow?: (
    mapped: Record<string, unknown>,
    templateId: string,
  ) => Record<string, unknown>
  findDuplicate: (record: Record<string, unknown>, ctx: ImportContext) => Promise<{ id: string; matchedOn: string[] } | null>
  createRecord: (record: Record<string, unknown>, ctx: ImportContext) => Promise<{ id: string }>
  updateRecord: (id: string, record: Record<string, unknown>, ctx: ImportContext) => Promise<void>
  /** Compensates a failed create before it can be reported as imported. */
  rollbackCreatedRecord?: (id: string, ctx: ImportContext) => Promise<void>
  exportRecords: (filters: Record<string, string>, ctx: ImportContext) => Promise<unknown[]>
  mapExportRow: (record: unknown) => Record<string, string | number | boolean | null>
  parseImportRow?: (mapped: Record<string, unknown>) => Record<string, unknown>
  /** Batch duplicate lookup — avoids N+1 queries during validate/import. */
  findDuplicatesBatch?: (
    rows: MappedRow[],
    ctx: ImportContext,
  ) => Promise<DuplicateMatch[]>
}

export interface ParsedFile {
  headers: string[]
  rows: Record<string, string>[]
  format: FileFormat
}

export interface ColumnMapping {
  [sourceHeader: string]: string | null
}

export interface MappedRow {
  rowNumber: number
  source: Record<string, string>
  mapped: Record<string, unknown>
}

export interface ValidationIssue {
  rowNumber: number
  fieldKey?: string
  code: string
  message: string
  severity: ValidationSeverity
}

export interface ValidationResult {
  issues: ValidationIssue[]
  errorCount: number
  warningCount: number
  validRowNumbers: number[]
  invalidRowNumbers: number[]
  summaryByCode: Record<string, number>
}

export interface DuplicateMatch {
  rowNumber: number
  existingId: string
  matchedOn: string[]
}

export interface ImportContext {
  companyId: string
  userId: string
}

export interface ImportProcessorResult {
  importedCount: number
  updatedCount: number
  skippedCount: number
  failedCount: number
  errors: ImportRowError[]
  paused?: boolean
}

export interface ImportRowError {
  rowNumber: number
  fieldKey?: string
  errorCode: string
  message: string
  rawRow?: Record<string, unknown>
  details?: import('./import/import-error').ImportErrorDetails
}

export interface ImportJobRecord {
  id: string
  companyId: string
  userId: string
  moduleKey: string
  filename: string
  fileFormat: FileFormat
  duplicateStrategy: DuplicateStrategy | null
  status: ImportJobStatus
  totalRows: number
  importedCount: number
  updatedCount: number
  skippedCount: number
  failedCount: number
  processedRows: number
  validRows: number | null
  invalidRows: number | null
  warningCount: number | null
  startedAt: string | null
  completedAt: string | null
  durationMs: number | null
  mappingSnapshot: Record<string, string> | null
  validationSummary: Record<string, number> | null
  errorSummary: Record<string, number> | null
  createdAt: string
  updatedAt: string
  batchSize?: number
  batchCursor?: number
  retryCount?: number
  pausedAt?: string | null
  lastHeartbeatAt?: string | null
  payloadSnapshot?: Record<string, unknown> | null
}

export interface MappingTemplateRecord {
  id: string
  companyId: string
  moduleKey: string
  name: string
  isDefault: boolean
  columnMapping: Record<string, string>
  headerFingerprint: string | null
  createdById: string | null
  createdAt: string
  updatedAt: string
}

export const TERMINAL_JOB_STATUSES: ImportJobStatus[] = ['completed', 'failed', 'cancelled']

export const ACTIVE_JOB_STATUSES: ImportJobStatus[] = [
  'pending',
  'parsing',
  'mapping',
  'validating',
  'processing',
]

/** File imports are streamed/batched by the job runner; no QuickBooks-sized row ceiling. */
export const MAX_IMPORT_ROWS = Number.MAX_SAFE_INTEGER
export const MAX_EXPORT_ROWS = 50_000
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
