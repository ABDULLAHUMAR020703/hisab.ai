import type { DuplicateStrategy, FileFormat, ImportJobStatus } from '../types'

export interface ImportHistoryRecord {
  id: string
  moduleKey: string
  moduleDisplayName: string
  filename: string
  fileFormat: FileFormat
  duplicateStrategy: DuplicateStrategy | null
  status: ImportJobStatus
  totalRows: number
  importedCount: number
  updatedCount: number
  skippedCount: number
  failedCount: number
  durationMs: number | null
  createdAt: string
  completedAt: string | null
  user: { id: string; name: string | null }
  hasErrorReport: boolean
}

export interface ImportHistoryListResult {
  items: ImportHistoryRecord[]
  total: number
  page: number
  limit: number
}

export interface ImportHistoryDetail extends ImportHistoryRecord {
  validRows: number | null
  invalidRows: number | null
  warningCount: number | null
  mappingSnapshot: Record<string, string> | null
  validationSummary: Record<string, number> | null
}
