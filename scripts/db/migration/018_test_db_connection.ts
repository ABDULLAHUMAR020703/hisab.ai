#!/usr/bin/env npx tsx
/**
 * Test Supabase Postgres connection from .env before running migrate:import.
 * Usage: npm run migrate:test-db
 */
import { loadProjectEnv } from './lib/load-env'
import { withPgClient } from './lib/pg-client'

loadProjectEnv()

async function main() {
  await withPgClient(async (client) => {
    const { rows } = await client.query('SELECT current_database() AS db, current_user AS user, now() AS ts')
    const row = rows[0]!
    console.log('Connection OK')
    console.log(`  database: ${row.db}`)
    console.log(`  user:     ${row.user}`)
    console.log(`  time:     ${row.ts}`)
  })
}

main().catch((err) => {
  console.error('Connection failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
