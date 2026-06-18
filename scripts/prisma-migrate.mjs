/**
 * Apply pending Prisma migrations at build time (PostgreSQL on Vercel).
 * SQLite on Vercel is synced at build time via scripts/prisma-sqlite-sync.mjs
 */
import { execSync } from 'node:child_process'

const databaseUrl = process.env.DATABASE_URL ?? ''
const isPostgres =
  databaseUrl.startsWith('postgresql://') || databaseUrl.startsWith('postgres://')

if (!isPostgres) {
  console.log('prisma-migrate: skip (no PostgreSQL DATABASE_URL at build)')
  process.exit(0)
}

const schema = 'prisma/schema.postgresql.prisma'
console.log('prisma-migrate: deploying to PostgreSQL...')
execSync(`npx prisma migrate deploy --schema ${schema}`, {
  stdio: 'inherit',
  env: process.env,
})
