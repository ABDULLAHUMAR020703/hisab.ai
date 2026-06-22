import process from 'node:process'
import { execSync } from 'node:child_process'

const databaseUrl = process.env.DATABASE_URL ?? 'file:./prisma/dev.db'
const isPostgres = databaseUrl.startsWith('postgresql://') || databaseUrl.startsWith('postgres://')
const schema = isPostgres ? 'prisma/schema.postgresql.prisma' : 'prisma/schema.prisma'
const env = {
  ...process.env,
  DIRECT_URL: process.env.DIRECT_URL || databaseUrl,
}

execSync(`npx prisma generate --schema ${schema}`, { stdio: 'inherit', env })

if (!isPostgres) {
  execSync('npm rebuild better-sqlite3', { stdio: 'inherit' })
}
