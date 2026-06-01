import process from 'node:process'
import pg from 'pg'

const { Client } = pg

const connectionString =
  process.env.SUPABASE_DATABASE_URL ??
  process.env.DIRECT_URL ??
  process.env.DATABASE_URL

if (!connectionString) {
  console.error('Missing database URL. Set SUPABASE_DATABASE_URL, DIRECT_URL, or DATABASE_URL.')
  process.exit(1)
}

const tables = [
  'User',
  'ChartOfAccount',
  'CompanySettings',
  'CostCenter',
  'TaxRate',
  'Sequence',
  'Customer',
  'Vendor',
  'Invoice',
  'Bill',
  'JournalEntry',
  'Payment',
]

const client = new Client({
  connectionString,
  ssl: connectionString.includes('supabase.co') || connectionString.includes('pooler.supabase.com')
    ? { rejectUnauthorized: false }
    : undefined,
})

try {
  await client.connect()
  console.log('hisab.ai Supabase table counts')
  for (const table of tables) {
    const { rows } = await client.query(`select count(*)::int as count from "${table}"`)
    console.log(`${table}: ${rows[0].count}`)
  }

  const { rows: authRows } = await client.query(`
    select u.email, u.role, u."authUserId", au.id is not null as has_auth_user
    from "User" u
    left join auth.users au on au.id = u."authUserId"
    order by u.email
  `)

  console.log('\nAuth links')
  for (const row of authRows) {
    console.log(`${row.email}: appRole=${row.role}, authLinked=${row.has_auth_user}`)
  }
} finally {
  await client.end()
}
