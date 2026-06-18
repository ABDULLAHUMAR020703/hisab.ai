import 'server-only'
import { execSync } from 'node:child_process'
import { getPrismaSchemaPath } from './database'

let schemaSynced = false

/**
 * Syncs the Prisma schema to the SQLite file used on Vercel.
 * The bundled prisma/dev.db may predate ZATCA columns; db push adds missing fields without migration history.
 */
export function ensureSqliteMigrated(sqliteDatabaseUrl: string): void {
  if (schemaSynced) return
  if (process.env.VERCEL !== '1') return

  const schema = getPrismaSchemaPath(sqliteDatabaseUrl)
  try {
    execSync(`npx prisma db push --schema ${schema} --skip-generate`, {
      stdio: 'pipe',
      env: { ...process.env, DATABASE_URL: sqliteDatabaseUrl },
    })
    schemaSynced = true
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[ensureSqliteMigrated] Schema sync failed:', message)
    throw error
  }
}
