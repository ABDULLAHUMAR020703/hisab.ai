import 'server-only'
import { PrismaClient } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import { getDatabaseUrl, isPostgresDatabase } from './database'
import { ensureSqliteMigrated } from './ensure-sqlite-migrated'
import { getSqliteDatabaseUrl } from './sqlite-db'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

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

export const prisma = globalForPrisma.prisma || createPrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

export default prisma
