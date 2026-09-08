/**
 * Regression: QuickBooks reuses small integer ids across entity types
 * (Account "2", Customer "2", Vendor "2" all exist). `quickbooks_migration_records`
 * and `quickbooks_migration_local_links` are keyed by
 * (company, realm, entity_type, source_id), so the page-state maps and the
 * link/unchanged checks built on them MUST be scoped by entity type.
 *
 * Before the fix, `loadQuickBooksMigrationPageState` filtered only on
 * `source_id` and keyed its maps by `source_id` alone, so verifying the link
 * for Customer "2" could read the Account "2" row and wrongly report
 * "QuickBooks Customer 2 linked to an unexpected native record" — even though
 * the customer's link was written correctly. That false negative then rolled
 * back freshly-created native records.
 *
 * Reproduces the NETKOM `source_link_verification` failures (82 accounts,
 * 3 customers) from migration session 29d07af1.
 *
 * Run: npx tsx --test tests/integrations/quickbooks-migration-link-entity-scope.test.ts
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'

const requireModule = createRequire(import.meta.url)
requireModule('../../scripts/zatca/setup-server-only.cjs')

process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'https://link-entity-scope-test.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'anon-test'
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'service-test'

const store = requireModule('../../src/lib/import-export/quickbooks/migration-store') as typeof import('../../src/lib/import-export/quickbooks/migration-store')

const CO = 'co-1'
const REALM = 'realm-1'

interface Rec { company_id: string; realm_id: string; entity_type: string; source_id: string; local_id: string; local_table: string; imported_at: string; payload_hash: string }
interface Lnk { company_id: string; realm_id: string; entity_type: string; source_id: string; local_table: string; local_id: string }

/** In-memory PostgREST honouring the `entity_type=eq.` and `source_id=in.` filters. */
function installFakeDb(records: Rec[], links: Lnk[]) {
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (!url.hostname.endsWith('.supabase.co')) return realFetch(input)
    const table = url.pathname.replace('/rest/v1/', '')
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

    const sourceIdParam = url.searchParams.get('source_id') ?? ''
    const ids = sourceIdParam.startsWith('in.')
      ? sourceIdParam.slice(3).replace(/^\(|\)$/g, '').split(',').map((v) => v.replace(/^"|"$/g, '')).filter(Boolean)
      : []
    const entParam = url.searchParams.get('entity_type') ?? ''
    const wantEntity = entParam.startsWith('eq.') ? entParam.slice(3) : null

    const rows: Array<Record<string, unknown>> =
      table === 'quickbooks_migration_records' ? (records as unknown as Array<Record<string, unknown>>)
        : table === 'quickbooks_migration_local_links' ? (links as unknown as Array<Record<string, unknown>>)
        : []
    const filtered = rows.filter((r) =>
      (ids.length === 0 || ids.includes(String(r.source_id)))
      && (!wantEntity || String(r.entity_type) === wantEntity),
    )
    return json(filtered)
  }) as typeof globalThis.fetch
  return () => { globalThis.fetch = realFetch }
}

const rowFor = (entity: string, id: string) => ({
  _quickbooksEntity: entity,
  _realmId: REALM,
  _quickbooksId: id,
  _quickbooksRaw: JSON.stringify({ Id: id }),
})

test('link state and verification are scoped to the entity type when ids collide across entities', async () => {
  const records: Rec[] = [
    { company_id: CO, realm_id: REALM, entity_type: 'Account', source_id: '2', local_id: 'acct-2-uuid', local_table: 'chart_of_accounts', imported_at: '2026-01-01T00:00:00Z', payload_hash: 'ha' },
    { company_id: CO, realm_id: REALM, entity_type: 'Customer', source_id: '2', local_id: 'cust-2-uuid', local_table: 'customers', imported_at: '2026-01-01T00:00:00Z', payload_hash: 'hc' },
    { company_id: CO, realm_id: REALM, entity_type: 'Vendor', source_id: '2', local_id: 'vend-2-uuid', local_table: 'vendors', imported_at: '2026-01-01T00:00:00Z', payload_hash: 'hv' },
  ]
  const links: Lnk[] = [
    { company_id: CO, realm_id: REALM, entity_type: 'Account', source_id: '2', local_table: 'chart_of_accounts', local_id: 'acct-2-uuid' },
    { company_id: CO, realm_id: REALM, entity_type: 'Customer', source_id: '2', local_table: 'customers', local_id: 'cust-2-uuid' },
    { company_id: CO, realm_id: REALM, entity_type: 'Vendor', source_id: '2', local_table: 'vendors', local_id: 'vend-2-uuid' },
  ]
  const restore = installFakeDb(records, links)
  try {
    // Verifying Customer "2" must read the Customer row, not Account/Vendor "2".
    const custState = await store.loadQuickBooksMigrationPageState(CO, REALM, ['2'], 'Customer')
    assert.equal(
      store.verifyQuickBooksRecordLinked(rowFor('Customer', '2'), 'cust-2-uuid', custState),
      null,
      'Customer 2 is correctly linked and must verify clean despite Account/Vendor 2 existing',
    )

    const acctState = await store.loadQuickBooksMigrationPageState(CO, REALM, ['2'], 'Account')
    assert.equal(store.verifyQuickBooksRecordLinked(rowFor('Account', '2'), 'acct-2-uuid', acctState), null)

    // A genuinely wrong expected id is still caught.
    assert.match(
      String(store.verifyQuickBooksRecordLinked(rowFor('Customer', '2'), 'wrong-uuid', custState)),
      /unexpected native record/,
    )
  } finally {
    restore()
  }
})

test('state maps are keyed by (entity_type, source_id) even without the query-side filter', async () => {
  const records: Rec[] = [
    { company_id: CO, realm_id: REALM, entity_type: 'Account', source_id: '9', local_id: 'a9', local_table: 'chart_of_accounts', imported_at: '2026-01-01T00:00:00Z', payload_hash: 'ha' },
    { company_id: CO, realm_id: REALM, entity_type: 'Item', source_id: '9', local_id: 'i9', local_table: 'inventory_items', imported_at: '2026-01-01T00:00:00Z', payload_hash: 'hi' },
  ]
  const links: Lnk[] = [
    { company_id: CO, realm_id: REALM, entity_type: 'Account', source_id: '9', local_table: 'chart_of_accounts', local_id: 'a9' },
    { company_id: CO, realm_id: REALM, entity_type: 'Item', source_id: '9', local_table: 'inventory_items', local_id: 'i9' },
  ]
  const restore = installFakeDb(records, links)
  try {
    // No entityType arg: both rows come back, but they must not clobber each other.
    const state = await store.loadQuickBooksMigrationPageState(CO, REALM, ['9'])
    assert.equal(store.verifyQuickBooksRecordLinked(rowFor('Account', '9'), 'a9', state), null)
    assert.equal(store.verifyQuickBooksRecordLinked(rowFor('Item', '9'), 'i9', state), null)
    // The Item hash and the Account hash are kept apart.
    assert.equal(store.isQuickBooksRecordUnchangedInState({ ...rowFor('Item', '9'), _quickbooksRaw: '{"Id":"9"}' }, state), false)
  } finally {
    restore()
  }
})
