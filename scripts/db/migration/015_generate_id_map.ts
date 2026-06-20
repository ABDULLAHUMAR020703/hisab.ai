#!/usr/bin/env npx tsx
/**
 * Phase C — Step 2: Build deterministic UUIDv5 ID map from export.
 * Usage: npx tsx scripts/db/migration/015_generate_id_map.ts
 */
import fs from 'node:fs'
import { ID_MAP_FILE, MIGRATION_NAMESPACE, COMPANY_ID } from './lib/constants'
import { ensureMigrationDirs, IdMapStore, loadExportManifest } from './lib/id-map-store'

async function main() {
  ensureMigrationDirs()
  const manifest = loadExportManifest()
  const map = IdMapStore.generateFromExport(manifest)

  fs.writeFileSync(ID_MAP_FILE, JSON.stringify(map, null, 2), 'utf8')

  const byType = new Map<string, number>()
  for (const entry of map.entries) {
    byType.set(entry.entity_type, (byType.get(entry.entity_type) ?? 0) + 1)
  }

  console.log('Generated migration ID map')
  console.log(`  Namespace:  ${MIGRATION_NAMESPACE}`)
  console.log(`  Company ID: ${COMPANY_ID}`)
  console.log(`  Output:     ${ID_MAP_FILE}`)
  console.log(`  Total entries: ${map.entries.length}\n`)

  for (const [type, count] of [...byType.entries()].sort()) {
    console.log(`  ${type.padEnd(26)} ${count}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
