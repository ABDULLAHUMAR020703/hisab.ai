import type { ExportTable } from './constants'

export interface ExportManifest {
  exportedAt: string
  sqlitePath: string
  tables: Record<string, { rowCount: number; file: string }>
}

export interface IdMapEntry {
  entity_type: ExportTable | 'CompanySettings'
  legacy_id: string
  supabase_id: string
  created_at: string
}

export interface MigrationIdMap {
  generatedAt: string
  namespace: string
  companyId: string
  entries: IdMapEntry[]
}

export type SqliteRow = Record<string, unknown>
