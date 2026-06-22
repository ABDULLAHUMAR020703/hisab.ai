/**
 * Apply pending Prisma migrations when explicitly enabled.
 * Vercel build workers may not be able to reach a direct Supabase Postgres host,
 * so deployments skip this by default and expect migrations to be run separately.
 */
import { execSync } from 'node:child_process'

const databaseUrl = process.env.DATABASE_URL ?? ''
const shouldRunMigrations = process.env.RUN_PRISMA_MIGRATE === 'true'
const isPostgres =
  databaseUrl.startsWith('postgresql://') || databaseUrl.startsWith('postgres://')

if (!shouldRunMigrations) {
  console.log('prisma-migrate: skip (set RUN_PRISMA_MIGRATE=true to deploy migrations)')
  process.exit(0)
}

if (!isPostgres) {
  console.log('prisma-migrate: skip (no PostgreSQL DATABASE_URL at build)')
  process.exit(0)
}

const schema = 'prisma/schema.postgresql.prisma'
const env = {
  ...process.env,
  DIRECT_URL: process.env.DIRECT_URL || databaseUrl,
}

console.log('prisma-migrate: deploying to PostgreSQL...')
execSync(`npx prisma migrate deploy --schema ${schema}`, {
  stdio: 'inherit',
  env,
})
