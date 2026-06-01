import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import pg from 'pg'

const { Client } = pg

const sqlPath = path.resolve(process.argv[2] ?? 'supabase/hisab_ai_supabase.sql')
const connectionString =
  process.env.SUPABASE_DATABASE_URL ??
  process.env.DIRECT_URL ??
  process.env.DATABASE_URL

if (!connectionString) {
  console.error('Missing database URL. Set SUPABASE_DATABASE_URL, DIRECT_URL, or DATABASE_URL.')
  process.exit(1)
}

const sql = await fs.readFile(sqlPath, 'utf8')
const client = new Client({
  connectionString,
  ssl: connectionString.includes('supabase.co') || connectionString.includes('pooler.supabase.com')
    ? { rejectUnauthorized: false }
    : undefined,
})

try {
  await client.connect()
  await client.query(sql)
  console.log(`Applied ${path.relative(process.cwd(), sqlPath)} successfully.`)
} finally {
  await client.end()
}
