/**
 * QUICKBOOKS_SNAPSHOT_STEP durable continuation — same model as
 * QUICKBOOKS_IMPORT_STEP (master 8490942): the next extraction step is scheduled
 * from a post-complete hook, AFTER the current step's queue row is COMPLETED, so
 * the standard "one active step per snapshot" (PENDING+RUNNING) index is never
 * contended. This drives extraction through a hand-rolled worker loop with that
 * index enforced and the same claim → run → completeJob → post-complete ordering.
 *
 * Run: npm run test:quickbooks-snapshot
 */
import { test, mock, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createFakeSupabase, SNAPSHOT_STEP_ACTIVE_INDEX } from './fake-supabase'

const requireModule = createRequire(import.meta.url)
requireModule('../../scripts/zatca/setup-server-only.cjs')
process.env.QB_SNAPSHOT_PAGES_PER_STEP = '1'

const MOCKS: string | false =
  typeof (mock as { module?: unknown }).module === 'function' ? false : 'requires --experimental-test-module-mocks'

const CONFIG = { clientId: 'c', clientSecret: 's', redirectUri: 'http://localhost/cb', environment: 'sandbox' as const, additionalScopes: [] }
const CONTEXT = { accessToken: 't', realmId: '77' }
const NOW = () => new Date('2026-01-01T00:00:00.000Z')
const COMPANY = 'co-77'
const USER = 'user-77'

const ACCOUNTS = [{ Id: 'a1', Name: 'Cash', AcctNum: '1000', AccountType: 'Bank', Active: true }]
const CUSTOMERS = [{ Id: 'c1', DisplayName: 'Acme', Active: true, Job: false }]
const INVOICES = [
  { Id: 'i1', DocNumber: '1', TxnDate: '2005-01-01', TotalAmt: 10, CustomerRef: { value: 'c1' }, Line: [] },
  { Id: 'i2', DocNumber: '2', TxnDate: '2019-01-01', TotalAmt: 20, CustomerRef: { value: 'c1' }, Line: [] },
]

function fakeFetch(): typeof fetch {
  return (async (input: string | URL): Promise<Response> => {
    const q = new URL(String(input)).searchParams.get('query') ?? ''
    const entity = /FROM (\w+)/.exec(q)?.[1] ?? ''
    const pos = Number(/STARTPOSITION (\d+)/.exec(q)?.[1] ?? '1')
    const max = Number(/MAXRESULTS (\d+)/.exec(q)?.[1] ?? '1000')
    if (/ORDERBY TxnDate ASC/.test(q) && /MAXRESULTS 1/.test(q)) {
      return json({ QueryResponse: { [entity]: [INVOICES[0]], startPosition: 1, maxResults: 1 } })
    }
    const src: Record<string, Array<Record<string, unknown>>> = { Account: ACCOUNTS, Customer: CUSTOMERS, Invoice: INVOICES }
    let rows = src[entity] ?? []
    const range = /TxnDate >= '([\d-]+)' AND TxnDate < '([\d-]+)'/.exec(q)
    if (range) rows = rows.filter((r) => String(r.TxnDate) >= range[1] && String(r.TxnDate) < range[2])
    return json({ QueryResponse: { [entity]: rows.slice(pos - 1, pos - 1 + max), startPosition: pos, maxResults: max } })
  }) as unknown as typeof fetch
}
const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } })

let fake: ReturnType<typeof createFakeSupabase>
let m: {
  createSnapshot: typeof import('../../src/lib/import-export/quickbooks/snapshot/snapshot.service')['createSnapshot']
  getSnapshot: typeof import('../../src/lib/import-export/quickbooks/snapshot/snapshot.service')['getSnapshot']
  runSnapshotOrchestratorStep: typeof import('../../src/lib/import-export/quickbooks/snapshot/snapshot-orchestrator')['runSnapshotOrchestratorStep']
  enqueueSnapshotStep: typeof import('../../src/lib/import-export/quickbooks/snapshot/snapshot-orchestrator')['enqueueSnapshotStep']
  ensureSnapshotContinuation: typeof import('../../src/lib/platform/continuation-scheduler')['ensureSnapshotContinuation']
  QuickBooksIntegrationService: typeof import('../../src/integrations/accounting/providers/quickbooks/quickbooks-integration.service')['QuickBooksIntegrationService']
}

before(async () => {
  if (MOCKS) return
  fake = createFakeSupabase({ uniqueIndexes: [SNAPSHOT_STEP_ACTIVE_INDEX] })
  mock.module('server-only', { namedExports: {}, defaultExport: {} })
  mock.module('@/lib/supabase/admin', { namedExports: { createAdminClient: () => fake.client } })
  const [svc, orch, sched, prov] = await Promise.all([
    import('../../src/lib/import-export/quickbooks/snapshot/snapshot.service'),
    import('../../src/lib/import-export/quickbooks/snapshot/snapshot-orchestrator'),
    import('../../src/lib/platform/continuation-scheduler'),
    import('../../src/integrations/accounting/providers/quickbooks/quickbooks-integration.service'),
  ])
  m = {
    createSnapshot: svc.createSnapshot,
    getSnapshot: svc.getSnapshot,
    runSnapshotOrchestratorStep: orch.runSnapshotOrchestratorStep,
    enqueueSnapshotStep: orch.enqueueSnapshotStep,
    ensureSnapshotContinuation: sched.ensureSnapshotContinuation,
    QuickBooksIntegrationService: prov.QuickBooksIntegrationService,
  }
})
after(() => mock.restoreAll())

/**
 * One worker cycle: claim a PENDING snapshot step (-> RUNNING), run it, mark it
 * COMPLETED, THEN run the post-complete continuation (mirrors processJob +
 * registerPostCompleteHook('QUICKBOOKS_SNAPSHOT_STEP')).
 */
async function pumpOneCycle(provider: unknown): Promise<{ claimed: boolean; done: boolean }> {
  const pending = (fake.db.get('job_queue') ?? []).find(
    (r) => r.job_type === 'QUICKBOOKS_SNAPSHOT_STEP' && r.status === 'PENDING',
  )
  if (!pending) return { claimed: false, done: true }
  pending.status = 'RUNNING'
  const p = pending.payload as { snapshotId: string; companyId: string; userId: string }
  const outcome = await m.runSnapshotOrchestratorStep({
    provider: provider as never,
    context: CONTEXT,
    snapshotId: p.snapshotId,
    companyId: p.companyId,
    userId: p.userId,
  })
  pending.status = 'COMPLETED' // completeJob()
  if (!outcome.done) {
    // post-complete hook
    await m.ensureSnapshotContinuation({ snapshotId: p.snapshotId, companyId: p.companyId, userId: p.userId })
  }
  return { claimed: true, done: outcome.done }
}

test('extraction chains to COMPLETE via the post-complete hook (PENDING+RUNNING index, no stall)', { skip: MOCKS }, async (t) => {
  const provider = new m.QuickBooksIntegrationService(CONFIG, fakeFetch(), NOW)
  const snapshot = await m.createSnapshot({
    companyId: COMPANY,
    realmId: CONTEXT.realmId,
    userId: USER,
    requestedResources: ['accounts', 'customers', 'invoices'],
  })
  await m.enqueueSnapshotStep({ snapshotId: snapshot.id, companyId: COMPANY, userId: USER })

  let cycles = 0
  for (; cycles < 50; cycles += 1) {
    const r = await pumpOneCycle(provider)
    if (!r.claimed) break
  }

  const final = await m.getSnapshot(snapshot.id, COMPANY)
  assert.equal(final?.status, 'COMPLETE', `stalled/failed after ${cycles} cycles: ${JSON.stringify(final?.validation ?? final)}`)
  assert.ok(cycles >= 3, 'multi-resource extraction must take multiple queued steps')
  const lingering = (fake.db.get('job_queue') ?? []).filter(
    (r) => r.job_type === 'QUICKBOOKS_SNAPSHOT_STEP' && (r.status === 'PENDING' || r.status === 'RUNNING'),
  )
  assert.equal(lingering.length, 0, 'no active step lingers after COMPLETE')
  t.diagnostic(`chained to COMPLETE in ${cycles} queued steps`)
})

test('scheduling the successor BEFORE the row is COMPLETED would 23505 and stall (ordering is load-bearing)', { skip: MOCKS }, async () => {
  const snap = await m.createSnapshot({ companyId: COMPANY, realmId: CONTEXT.realmId, userId: USER, requestedResources: ['accounts'] })
  // Current step is RUNNING (not yet COMPLETED).
  fake.db.set('job_queue', [
    ...(fake.db.get('job_queue') ?? []),
    { id: 'running-1', job_type: 'QUICKBOOKS_SNAPSHOT_STEP', company_id: COMPANY, status: 'RUNNING', payload: { snapshotId: snap.id } },
  ])
  const res = await m.ensureSnapshotContinuation({ snapshotId: snap.id, companyId: COMPANY, userId: USER })
  // The scheduler sees the active RUNNING row and returns it instead of inserting.
  assert.ok(res.existing, 'while a step is still active the scheduler must not create a second step')
  assert.equal(res.created, undefined)
})

test('ensureSnapshotContinuation is idempotent: creates once, then dedupes', { skip: MOCKS }, async () => {
  fake.db.set('job_queue', [])
  const snap = await m.createSnapshot({ companyId: COMPANY, realmId: CONTEXT.realmId, userId: USER, requestedResources: ['accounts'] })
  const first = await m.ensureSnapshotContinuation({ snapshotId: snap.id, companyId: COMPANY, userId: USER })
  assert.ok(first.created, 'first call creates a durable step')
  const second = await m.ensureSnapshotContinuation({ snapshotId: snap.id, companyId: COMPANY, userId: USER })
  assert.ok(second.existing, 'second call returns the existing PENDING step')
  const rows = (fake.db.get('job_queue') ?? []).filter(
    (r) => r.job_type === 'QUICKBOOKS_SNAPSHOT_STEP' && (r.payload as { snapshotId: string }).snapshotId === snap.id,
  )
  assert.equal(rows.length, 1)
})
