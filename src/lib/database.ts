/**
 * Database provider detection for dual SQLite (dev) / PostgreSQL (staging/production) support.
 */

export function getDatabaseUrl(): string {
  return process.env.DATABASE_URL ?? 'file:./prisma/dev.db'
}

export function isPostgresDatabase(url = getDatabaseUrl()): boolean {
  return url.startsWith('postgresql://') || url.startsWith('postgres://')
}

export function getPrismaSchemaPath(url = getDatabaseUrl()): string {
  return isPostgresDatabase(url) ? 'prisma/schema.postgresql.prisma' : 'prisma/schema.prisma'
}
