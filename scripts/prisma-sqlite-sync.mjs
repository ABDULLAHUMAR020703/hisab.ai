/**
 * Sync bundled prisma/dev.db to current schema at build time (Vercel + local builds).
 * Runtime db push on serverless fails — npm cannot write to /home/sbx_user1051.
 */
import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

const databaseUrl = process.env.DATABASE_URL ?? ''
const isPostgres =
  databaseUrl.startsWith('postgresql://') || databaseUrl.startsWith('postgres://')

if (isPostgres) {
  console.log('prisma-sqlite-sync: skip (PostgreSQL DATABASE_URL)')
  process.exit(0)
}

const dbPath = path.join(process.cwd(), 'prisma', 'dev.db')
if (!existsSync(dbPath)) {
  console.log('prisma-sqlite-sync: prisma/dev.db will be created')
}

console.log('prisma-sqlite-sync: updating bundled SQLite schema...')
execSync(
  'npx prisma db push --schema prisma/schema.prisma --accept-data-loss',
  {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: 'file:./prisma/dev.db' },
  },
)
