import fs from 'node:fs'
import path from 'node:path'
import type pg from 'pg'
import { ID_MAP_FILE, MANIFEST_FILE, MIGRATION_ROOT, MIGRATION_NAMESPACE, COMPANY_ID } from './constants'
import { deterministicId } from './uuid'
import type { ExportTable, ExportManifest } from './types'
import { EXPORT_TABLES } from './constants'
import { toTimestamptz } from './transforms'
import type { IdMapEntry, MigrationIdMap, SqliteRow } from './types'

export class IdMapStore {
  private byType = new Map<string, Map<string, IdMapEntry>>()

  static loadFromFile(): IdMapStore {
    const store = new IdMapStore()
    if (!fs.existsSync(ID_MAP_FILE)) {
      throw new Error(`ID map not found: ${ID_MAP_FILE}. Run 015_generate_id_map.ts first.`)
    }
    const data = JSON.parse(fs.readFileSync(ID_MAP_FILE, 'utf8')) as MigrationIdMap
    for (const entry of data.entries) {
      if (!store.byType.has(entry.entity_type)) {
        store.byType.set(entry.entity_type, new Map())
      }
      store.byType.get(entry.entity_type)!.set(entry.legacy_id, entry)
    }
    return store
  }

  static generateFromExport(manifest: ExportManifest): MigrationIdMap {
    const entries: IdMapEntry[] = []
    const generatedAt = new Date().toISOString()

    for (const table of EXPORT_TABLES) {
      const info = manifest.tables[table]
      if (!info) continue

      const filePath = path.join(path.dirname(MANIFEST_FILE), info.file)
      const rows = JSON.parse(fs.readFileSync(filePath, 'utf8')) as SqliteRow[]

      for (const row of rows) {
        const legacyId = String(row.id)
        const createdAt =
          toTimestamptz(row.createdAt) ??
          toTimestamptz(row.created_at) ??
          generatedAt

        entries.push({
          entity_type: table,
          legacy_id: legacyId,
          supabase_id: deterministicId(table, legacyId),
          created_at: createdAt,
        })
      }
    }

    return {
      generatedAt,
      namespace: MIGRATION_NAMESPACE,
      companyId: COMPANY_ID,
      entries,
    }
  }

  resolve(entityType: ExportTable | 'CompanySettings' | 'User', legacyId: string | null | undefined): string | null {
    if (!legacyId) return null
    return this.byType.get(entityType)?.get(legacyId)?.supabase_id ?? null
  }

  require(entityType: ExportTable | 'CompanySettings' | 'User', legacyId: string | null | undefined): string {
    const id = this.resolve(entityType, legacyId)
    if (!id) {
      throw new Error(`Missing ID map entry for ${entityType}:${legacyId}`)
    }
    return id
  }

  /** Override mapped UUID (e.g. when auth.users already exists with a different id) */
  setSupabaseId(entityType: ExportTable | 'CompanySettings' | 'User', legacyId: string, supabaseId: string): void {
    const entry = this.byType.get(entityType)?.get(legacyId)
    if (entry) {
      entry.supabase_id = supabaseId
    }
  }

  allEntries(): IdMapEntry[] {
    const out: IdMapEntry[] = []
    for (const map of this.byType.values()) {
      out.push(...map.values())
    }
    return out
  }

  async persistToPostgres(client: pg.Client): Promise<number> {
    const entries = this.allEntries()
    if (entries.length === 0) return 0

    const chunkSize = 200
    for (let offset = 0; offset < entries.length; offset += chunkSize) {
      const chunk = entries.slice(offset, offset + chunkSize)
      const values: unknown[] = []
      const placeholders: string[] = []
      let i = 1

      for (const entry of chunk) {
        placeholders.push(`($${i++}, $${i++}, $${i++}, $${i++})`)
        values.push(entry.entity_type, entry.legacy_id, entry.supabase_id, entry.created_at)
      }

      await client.query(
        `INSERT INTO public.migration_id_map (entity_type, legacy_id, supabase_id, created_at)
         VALUES ${placeholders.join(', ')}
         ON CONFLICT (entity_type, legacy_id) DO UPDATE SET
           supabase_id = EXCLUDED.supabase_id,
           created_at = EXCLUDED.created_at`,
        values,
      )
    }
    return entries.length
  }
}

export function loadExportManifest(): ExportManifest {
  if (!fs.existsSync(MANIFEST_FILE)) {
    throw new Error(`Export manifest not found: ${MANIFEST_FILE}. Run 014_export_sqlite.ts first.`)
  }
  return JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8')) as ExportManifest
}

export function loadExportTable(table: ExportTable): SqliteRow[] {
  const manifest = loadExportManifest()
  const info = manifest.tables[table]
  if (!info) return []
  const filePath = path.join(path.dirname(MANIFEST_FILE), info.file)
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as SqliteRow[]
}

export function ensureMigrationDirs(): void {
  fs.mkdirSync(MIGRATION_ROOT, { recursive: true })
  fs.mkdirSync(path.join(MIGRATION_ROOT, 'export'), { recursive: true })
}
