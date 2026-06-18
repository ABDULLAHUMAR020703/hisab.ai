import 'server-only'
import { execSync } from 'node:child_process'
import { getPrismaSchemaPath } from './database'

let schemaSynced = false

function isNextBuildPhase(): boolean {
  const phase = process.env.NEXT_PHASE
  return phase === 'phase-production-build' || phase === 'phase-export'
}

/**
 * Syncs the Prisma schema to the SQLite file used on Vercel at request runtime.
 * Skipped during `next build` — db push cannot run in the Vercel build environment.
 */
export function ensureSqliteMigrated(sqliteDatabaseUrl: string): void {
  if (schemaSynced) return
  if (process.env.VERCEL !== '1') return
  if (isNextBuildPhase()) return

  const schema = getPrismaSchemaPath(sqliteDatabaseUrl)
  try {
    execSync(
      `npx prisma db push --schema ${schema} --skip-generate --accept-data-loss`,
      {
        stdio: 'pipe',
        env: { ...process.env, DATABASE_URL: sqliteDatabaseUrl },
      },
    )
    schemaSynced = true
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[ensureSqliteMigrated] Schema sync failed:', message)
    throw error
  }
}
