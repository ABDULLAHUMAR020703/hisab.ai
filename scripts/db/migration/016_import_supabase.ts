#!/usr/bin/env npx tsx
/**
 * Phase C — Step 3: Import staged JSON into Supabase PostgreSQL.
 *   - Migrations 001–013 applied (including migration_id_map)
 *   - Seed 001_default_company.sql applied
 *   - 014_export_sqlite.ts + 015_generate_id_map.ts completed
 *
 * Environment:
 *   SUPABASE_DATABASE_URL | DIRECT_URL | DATABASE_URL  — Postgres connection
 *   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY           — auth user creation (optional)
 *   MIGRATION_USER_PASSWORD                            — default password for migrated users
 *
 * Usage: npx tsx scripts/db/migration/016_import_supabase.ts [--dry-run]
 */
import { loadProjectEnv } from './lib/load-env'
import { IdMapStore } from './lib/id-map-store'
import { runFullImport } from './lib/import-runner'
import { withPgClient } from './lib/pg-client'

loadProjectEnv()

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const map = IdMapStore.loadFromFile()

  console.log(`Loaded ${map.allEntries().length} ID map entries\n`)

  if (dryRun) {
    console.log('Dry run — no database writes. Remove --dry-run to import.')
    return
  }

  await withPgClient(async (client) => {
    await client.query('BEGIN')
    try {
      const result = await runFullImport(client, map)
      await client.query('COMMIT')

      console.log('\nImport complete:\n')
      for (const s of result.stats) {
        console.log(`  ${s.table.padEnd(28)} ${String(s.inserted).padStart(5)} rows`)
      }
      console.log(`\n  migration_id_map             ${String(result.idMapRows).padStart(5)} entries`)
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    }
  })
}

main().catch((err) => {
  console.error('Import failed:', err)
  process.exit(1)
})
