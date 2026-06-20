import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import pg from 'pg'

const { Client } = pg

const migrationsDir = path.resolve('supabase/migrations')
const connectionString =
  process.env.SUPABASE_DATABASE_URL ??
  process.env.DIRECT_URL ??
  process.env.DATABASE_URL

if (!connectionString?.startsWith('postgres')) {
  console.error('Set SUPABASE_DATABASE_URL or DATABASE_URL to a postgresql:// connection string.')
  process.exit(1)
}

const files = (await fs.readdir(migrationsDir))
  .filter((f) => f.endsWith('.sql'))
  .sort()

const client = new Client({
  connectionString,
  ssl:
    connectionString.includes('supabase.co') || connectionString.includes('pooler.supabase.com')
      ? { rejectUnauthorized: false }
      : undefined,
})

await client.connect()

try {
  for (const file of files) {
    const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8')
    console.log(`Applying ${file}...`)
    await client.query(sql)
    console.log(`  OK`)
  }
  console.log(`\nApplied ${files.length} migration(s) successfully.`)
} finally {
  await client.end()
}
