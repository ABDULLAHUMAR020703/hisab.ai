import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const requireModule = createRequire(import.meta.url)
requireModule('../../scripts/zatca/setup-server-only.cjs')

const { QuickBooksIntegrationService } = requireModule(
  '../../src/integrations/accounting/providers/quickbooks/quickbooks-integration.service',
) as typeof import('../../src/integrations/accounting/providers/quickbooks/quickbooks-integration.service')

const CONFIG = { clientId: 'c', clientSecret: 's', redirectUri: 'http://localhost/cb', environment: 'sandbox' as const, additionalScopes: [] }
const CONTEXT = { accessToken: 'token', realmId: '900' }
const NOW = () => new Date('2026-01-01T00:00:00.000Z') // provider horizon => 2027-01-01

/**
 * A fake QuickBooks query endpoint over an in-memory Invoice dataset. Faithfully
 * echoes `startPosition`, honours `STARTPOSITION`/`MAXRESULTS`, and slices by the
 * `TxnDate >= x AND TxnDate < y` predicate the partitioned pager builds.
 */
function makeFetch(invoices: Array<{ Id: string; TxnDate: string }>): typeof fetch {
  return (async (input: string | URL): Promise<Response> => {
    const query = new URL(String(input)).searchParams.get('query') ?? ''
    if (/ORDERBY TxnDate ASC/.test(query) && /MAXRESULTS 1/.test(query)) {
      const earliest = [...invoices].sort((a, b) => a.TxnDate.localeCompare(b.TxnDate))[0]
      return json({ QueryResponse: { Invoice: earliest ? [earliest] : [], startPosition: 1, maxResults: 1 } })
    }
    const range = /TxnDate >= '([\d-]+)' AND TxnDate < '([\d-]+)'/.exec(query)
    const pos = Number(/STARTPOSITION (\d+)/.exec(query)?.[1] ?? '1')
    const max = Number(/MAXRESULTS (\d+)/.exec(query)?.[1] ?? '1000')
    let rows = [...invoices].sort((a, b) => a.TxnDate.localeCompare(b.TxnDate) || a.Id.localeCompare(b.Id))
    if (range) rows = rows.filter((r) => r.TxnDate >= range[1] && r.TxnDate < range[2])
    return json({ QueryResponse: { Invoice: rows.slice(pos - 1, pos - 1 + max), startPosition: pos, maxResults: max } })
  }) as unknown as typeof fetch
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

/**
 * Drives `getEntityRecords` for `Invoice` with `partitioned: true` and the given
 * `maxPages`/`pageSize`, re-invoking with the last checkpoint until the provider
 * reports no more work — exactly as the durable snapshot / import callers do.
 * Returns every page emitted through `onPage`.
 */
async function drainPartitioned(
  invoices: Array<{ Id: string; TxnDate: string }>,
  opts: { maxPages?: number; pageSize: number },
) {
  const provider = new QuickBooksIntegrationService(CONFIG, makeFetch(invoices), NOW)
  const pages: Array<{ ids: string[]; partitionStart?: string; partitionEnd?: string; partitionComplete?: boolean; hasMore?: boolean }> = []
  let resume: { startPosition: number; partitionStart?: string } = { startPosition: 1 }
  let steps = 0
  for (; steps < 500; steps += 1) {
    let last: Record<string, unknown> | undefined
    await provider.getEntityRecords!(CONTEXT, 'Invoice', {
      partitioned: true,
      pageSize: opts.pageSize,
      maxPages: opts.maxPages,
      startPosition: resume.startPosition,
      partitionStart: resume.partitionStart ? new Date(resume.partitionStart) : undefined,
      retainRows: false,
      onPage: async (page, cp) => {
        pages.push({
          ids: (page as Array<{ Id: string }>).map((r) => r.Id),
          partitionStart: cp.partitionStart,
          partitionEnd: cp.partitionEnd,
          partitionComplete: cp.partitionComplete,
          hasMore: cp.hasMore,
        })
        last = cp as Record<string, unknown>
      },
      onCheckpoint: async (cp) => {
        last = cp as Record<string, unknown>
      },
    })
    if (!last) break
    const more = Boolean(last.hasMore || last.partitionComplete)
    if (!more) break
    resume = {
      startPosition: Number(last.startPosition ?? 1),
      partitionStart: (last.partitionStart as string | undefined) ?? resume.partitionStart,
    }
  }
  const ids = pages.flatMap((p) => p.ids)
  return { pages, steps, ids, allIds: new Set(ids) }
}

// The first window-0 record is the earliest transaction (2003-06-01), so the
// provider builds 3 windows:
//   [2003-06-01, 2013-06-01)  [2013-06-01, 2023-06-01)  [2023-06-01, 2027-01-01)
// perWindow[w] records are placed safely inside window w. When perWindow[0] is 0
// the earliest anchor still lands in window 0 via the first non-empty window.
const WINDOW_YEARS = ['2003', '2015', '2024']

function dataset(perWindow: [number, number, number]): Array<{ Id: string; TxnDate: string }> {
  const rows: Array<{ Id: string; TxnDate: string }> = []
  let id = 1
  perWindow.forEach((count, w) => {
    for (let i = 0; i < count; i += 1) {
      const day = String((i % 27) + 1).padStart(2, '0')
      rows.push({ Id: String(id++), TxnDate: `${WINDOW_YEARS[w]}-06-${day}` })
    }
  })
  return rows
}

const recordWindowStarts = (pages: Array<{ ids: string[]; partitionStart?: string }>) =>
  [...new Set(pages.filter((p) => p.ids.length > 0).map((p) => p.partitionStart?.slice(0, 10)))].sort()

test('partial final page in each window: no records lost, three contiguous windows', async () => {
  const data = dataset([3, 2, 4]) // none is a multiple of pageSize 2
  const { ids, allIds, pages } = await drainPartitioned(data, { maxPages: 100, pageSize: 2 })
  assert.equal(ids.length, 9)
  assert.equal(allIds.size, 9)
  assert.deepEqual(recordWindowStarts(pages), ['2003-06-01', '2013-06-01', '2023-06-01'])
})

test('exactly-full pages (window size is a multiple of pageSize): still no loss, window still advances', async () => {
  const data = dataset([4, 4, 2]) // window sizes multiples of pageSize 2
  const { ids, allIds } = await drainPartitioned(data, { maxPages: 100, pageSize: 2 })
  assert.equal(ids.length, 10)
  assert.equal(allIds.size, 10, 'no duplicates, no drops even when the last page of a window is full')
})

test('a single window larger than maxPages x pageSize is fully extracted (the fixed bug)', async () => {
  // Window 1 has 25 records; maxPages 3 x pageSize 2 = 6 records per step.
  const data = dataset([25, 3, 2])
  const bounded = await drainPartitioned(data, { maxPages: 3, pageSize: 2 })
  const unbounded = await drainPartitioned(data, { maxPages: undefined as unknown as number, pageSize: 1000 })
  assert.equal(bounded.ids.length, 30, 'bounded run must not skip records past maxPages x pageSize')
  assert.equal(bounded.allIds.size, 30, 'no duplicates across resumed steps')
  assert.deepEqual([...bounded.allIds].sort((a, b) => Number(a) - Number(b)), [...unbounded.allIds].sort((a, b) => Number(a) - Number(b)))
  assert.ok(bounded.steps > 5, 'a >6-record window at 6 records/step needs multiple steps')
})

test('continuation after a FULL page resumes mid-window (does not jump to the next window)', async () => {
  const data = dataset([10, 0, 0]) // one window, 10 records, pageSize 2, maxPages 1 -> full page each step
  const { pages, ids, allIds } = await drainPartitioned(data, { maxPages: 1, pageSize: 2 })
  assert.equal(ids.length, 10)
  assert.equal(allIds.size, 10)
  // Every record-bearing page belongs to the first window; we never advanced early.
  assert.deepEqual(recordWindowStarts(pages), ['2003-06-01'])
})

test('continuation after a PARTIAL page advances to the next window', async () => {
  const data = dataset([3, 3, 0]) // two windows, 3 each, pageSize 2 -> each window ends on a partial page
  const { pages, ids, allIds } = await drainPartitioned(data, { maxPages: 1, pageSize: 2 })
  assert.equal(ids.length, 6)
  assert.equal(allIds.size, 6)
  assert.deepEqual(recordWindowStarts(pages), ['2003-06-01', '2013-06-01'])
})

test('multiple partition windows with mixed page fullness: complete, contiguous, unique', async () => {
  const data = dataset([4, 3, 6]) // full-ending, partial-ending, full-ending
  const { ids, allIds, pages } = await drainPartitioned(data, { maxPages: 2, pageSize: 2 })
  assert.equal(ids.length, 13)
  assert.equal(allIds.size, 13)
  const windows = recordWindowStarts(pages)
  assert.deepEqual(windows, ['2003-06-01', '2013-06-01', '2023-06-01'])
  for (let i = 1; i < windows.length; i += 1) {
    assert.ok(windows[i] > windows[i - 1], 'windows strictly increasing, no overlap')
  }
})
