import 'server-only'
import { PrismaClient } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import { getDatabaseUrl, isPostgresDatabase } from './database'
import { ensureSqliteMigrated } from './ensure-sqlite-migrated'
import { getSqliteDatabaseUrl } from './sqlite-db'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined }

function createPrismaClient() {
  const databaseUrl = getDatabaseUrl()

  if (isPostgresDatabase(databaseUrl)) {
    const pool = new pg.Pool({ connectionString: databaseUrl })
    const adapter = new PrismaPg(pool)
    return new PrismaClient({ adapter })
  }

  const sqliteUrl = getSqliteDatabaseUrl()
  ensureSqliteMigrated(sqliteUrl)
  const adapter = new PrismaBetterSqlite3({ url: sqliteUrl })
  return new PrismaClient({ adapter })
}

function getPrismaClient(): PrismaClient {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createPrismaClient()
  }
  return globalForPrisma.prisma
}

/** Lazy Prisma client — avoids DB access during Next.js build static analysis. */
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getPrismaClient()
    const value = client[prop as keyof PrismaClient]
    if (typeof value === 'function') {
      return (value as (...args: unknown[]) => unknown).bind(client)
    }
    return value
  },
})

export default prisma
