import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import pg from 'pg'

const { Client } = pg

const seedPath = path.resolve(process.argv[2] ?? 'supabase/seed/001_default_company.sql')
const connectionString =
  process.env.SUPABASE_DATABASE_URL ??
  process.env.DIRECT_URL ??
  process.env.DATABASE_URL

if (!connectionString?.startsWith('postgres')) {
  console.error('Set SUPABASE_DATABASE_URL or DATABASE_URL to a postgresql:// connection string.')
  process.exit(1)
}

const sql = await fs.readFile(seedPath, 'utf8')
const client = new Client({
  connectionString,
  ssl:
    connectionString.includes('supabase.co') || connectionString.includes('pooler.supabase.com')
      ? { rejectUnauthorized: false }
      : undefined,
})

try {
  await client.connect()
  await client.query(sql)
  console.log(`Applied seed ${path.relative(process.cwd(), seedPath)} successfully.`)
} finally {
  await client.end()
}
