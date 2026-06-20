import process from 'node:process'
import pg from 'pg'

const { Client } = pg

const connectionString =
  process.env.SUPABASE_DATABASE_URL ??
  process.env.DIRECT_URL ??
  process.env.DATABASE_URL

if (!connectionString?.startsWith('postgres')) {
  console.error('Set SUPABASE_DATABASE_URL or DATABASE_URL to a postgresql:// connection string.')
  process.exit(1)
}

const phaseATables = [
  'companies',
  'company_settings',
  'company_zatca_settings',
  'company_subscriptions',
  'company_users',
  'profiles',
  'user_preferences',
  'invitations',
  'zatca_credentials',
  'zatca_onboarding_requests',
]

const client = new Client({
  connectionString,
  ssl:
    connectionString.includes('supabase.co') || connectionString.includes('pooler.supabase.com')
      ? { rejectUnauthorized: false }
      : undefined,
})

try {
  await client.connect()
  console.log('hisab.ai Supabase Phase A verification\n')

  for (const table of phaseATables) {
    const { rows } = await client.query(`SELECT count(*)::int AS count FROM public.${table}`)
    console.log(`${table}: ${rows[0].count}`)
  }

  const { rows: fnRows } = await client.query(`
    SELECT proname FROM pg_proc
    WHERE proname IN ('user_company_ids', 'user_company_role', 'user_has_company_role')
    ORDER BY proname
  `)
  console.log('\nRLS helper functions:', fnRows.map((r) => r.proname).join(', ') || '(none)')

  const { rows: rlsRows } = await client.query(`
    SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = ANY($1::text[])
    ORDER BY c.relname
  `, [phaseATables])

  console.log('\nRLS enabled:')
  for (const row of rlsRows) {
    console.log(`  ${row.table_name}: ${row.rls_enabled ? 'yes' : 'NO'}`)
  }

  const { rows: company } = await client.query(`
    SELECT id, slug, company_name FROM public.companies ORDER BY created_at LIMIT 3
  `)
  console.log('\nSample companies:')
  for (const row of company) {
    console.log(`  ${row.slug} (${row.id}) — ${row.company_name}`)
  }
} finally {
  await client.end()
}
