import pg from 'pg'
import { loadProjectEnv } from './load-env'

const { Client } = pg

loadProjectEnv()

function validatePostgresUrl(connectionString: string | undefined, source: string): string {
  if (!connectionString?.startsWith('postgres')) {
    throw new Error(
      `${source} must be a postgresql:// connection string.\n`
      + 'Set SUPABASE_DATABASE_URL in .env (Supabase Dashboard → Settings → Database → URI).',
    )
  }
  if (connectionString.includes('[') || connectionString.includes('[PROJECT_REF]') || connectionString.includes('[PASSWORD]')) {
    throw new Error(
      `${source} still contains placeholders like [PASSWORD] or [PROJECT_REF].\n`
      + 'Edit .env and paste your real Supabase database URI with your database password.',
    )
  }
  if (connectionString.includes('YOUR_DB_PASSWORD')) {
    throw new Error(
      `${source} still contains YOUR_DB_PASSWORD.\n`
      + 'Replace it with your Supabase database password (Dashboard → Settings → Database → Reset password, then copy URI).',
    )
  }
  return connectionString
}

export function getConnectionString(): string {
  const candidates: Array<[string | undefined, string]> = [
    [process.env.SUPABASE_DATABASE_URL, 'SUPABASE_DATABASE_URL'],
    [process.env.DIRECT_URL, 'DIRECT_URL'],
    [process.env.DATABASE_URL, 'DATABASE_URL'],
  ]

  for (const [value, name] of candidates) {
    if (value?.startsWith('postgres')) {
      return validatePostgresUrl(value, name)
    }
  }

  throw new Error(
    'No Postgres connection found in .env.\n'
    + 'Add SUPABASE_DATABASE_URL from Supabase Dashboard → Settings → Database → Connection string → URI\n'
    + 'Example:\n'
    + 'SUPABASE_DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@db.njnmnjofntqrxvwpxgal.supabase.co:5432/postgres"',
  )
}

export async function withPgClient<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const connectionString = getConnectionString()
  const client = new Client({
    connectionString,
    ssl:
      connectionString.includes('supabase.co') || connectionString.includes('pooler.supabase.com')
        ? { rejectUnauthorized: false }
        : undefined,
  })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}
