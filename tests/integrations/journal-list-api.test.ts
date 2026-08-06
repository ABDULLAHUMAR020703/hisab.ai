import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

test('journal list API scopes like Recent Activity (company + soft-delete)', () => {
  const route = read('src/app/api/journal/route.ts')
  const dashboard = read('src/lib/db/repositories/dashboard.repository.supabase.ts')

  assert.match(dashboard, /from\('journal_entries'\)/)
  assert.match(dashboard, /\.eq\('company_id', companyId\)/)
  assert.match(dashboard, /\.is\('deleted_at', null\)/)

  assert.match(route, /from\('journal_entries'\)/)
  assert.match(route, /\.eq\('company_id', companyId\)/)
  assert.match(route, /\.is\('deleted_at', null\)/)
  assert.match(route, /resolveCompanyId\(\)/)
  assert.match(route, /createAdminClient\(\)/)
  assert.match(route, /journal_lines/)
  assert.match(route, /chart_of_accounts/)

  // Must not use the broken Prisma AND/OR listing shape that PostgREST rejects.
  assert.doesNotMatch(route, /prisma\.journalEntry\.findMany/)
  assert.doesNotMatch(route, /AND:\s*\[/)
})

test('journal page surfaces empty list only after a successful fetch', () => {
  const page = read('src/app/(dashboard)/journal/page.tsx')
  assert.match(page, /fetch\(`\/api\/journal\?\$\{params\}`\)/)
  assert.match(page, /if \(entRes\.ok\)/)
  assert.match(page, /setEntries\(await entRes\.json\(\)\)/)
  assert.match(page, /readApiError\(entRes\)/)
})
