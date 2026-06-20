#!/usr/bin/env npx tsx
/**
 * Phase C — Step 1: Export all SQLite (Prisma) data to JSON staging files.
 * Usage: npx tsx scripts/db/migration/014_export_sqlite.ts [--db path/to/dev.db]
 */
import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import {
  DEFAULT_SQLITE_PATH,
  EXPORT_DIR,
  EXPORT_TABLES,
  MANIFEST_FILE,
} from './lib/constants'
import { ensureMigrationDirs } from './lib/id-map-store'
import type { ExportManifest } from './lib/types'

function parseArgs(): { dbPath: string } {
  const idx = process.argv.indexOf('--db')
  const dbPath = idx >= 0 ? process.argv[idx + 1]! : DEFAULT_SQLITE_PATH
  if (!fs.existsSync(dbPath)) {
    console.error(`SQLite database not found: ${dbPath}`)
    process.exit(1)
  }
  return { dbPath }
}

function tableExists(db: Database.Database, table: string): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
    .get(table) as { name: string } | undefined
  return Boolean(row)
}

function exportTable(db: Database.Database, table: string): { rows: Record<string, unknown>[]; file: string } {
  if (!tableExists(db, table)) {
    console.warn(`  skip ${table} (table not found)`)
    return { rows: [], file: `${table}.json` }
  }

  const rows = db.prepare(`SELECT * FROM "${table}"`).all() as Record<string, unknown>[]
  const file = `${table}.json`
  fs.writeFileSync(path.join(EXPORT_DIR, file), JSON.stringify(rows, null, 2), 'utf8')
  return { rows, file }
}

async function main() {
  const { dbPath } = parseArgs()
  ensureMigrationDirs()

  console.log(`Exporting SQLite → ${EXPORT_DIR}`)
  console.log(`Source: ${dbPath}\n`)

  const db = new Database(dbPath, { readonly: true })
  const manifest: ExportManifest = {
    exportedAt: new Date().toISOString(),
    sqlitePath: dbPath,
    tables: {},
  }

  let totalRows = 0

  for (const table of EXPORT_TABLES) {
    const { rows, file } = exportTable(db, table)
    manifest.tables[table] = { rowCount: rows.length, file }
    totalRows += rows.length
    console.log(`  ${table.padEnd(26)} ${String(rows.length).padStart(5)} rows → ${file}`)
  }

  db.close()

  fs.writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 2), 'utf8')

  console.log(`\nExported ${totalRows} rows across ${EXPORT_TABLES.length} tables`)
  console.log(`Manifest: ${MANIFEST_FILE}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
