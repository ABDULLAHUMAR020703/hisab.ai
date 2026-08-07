import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { AccountingProvider } from '../../src/integrations/accounting/contracts/accounting-provider'
import { QuickBooksIntegrationService } from '../../src/integrations/accounting/providers/quickbooks/quickbooks-integration.service'
import { MODULE_CATALOG } from '../../src/lib/import-export/registry/module-catalog'
import { getQuickBooksPreviewSupport, QuickBooksImportAdapter } from '../../src/lib/import-export/sources/quickbooks.adapter'
import { generateIsolatedPreviews, PreviewProfiler, PreviewStageError } from '../../src/lib/import-export/sources/preview-service'
import type { SourcePreviewBatch } from '../../src/lib/import-export/sources/types'

const descriptors = [
  { key: 'accounts', label: 'Chart of Accounts', moduleKey: 'accounts' },
  { key: 'customers', label: 'Customers', moduleKey: 'customers' },
]

const base = {
  resources: descriptors,
  correlationId: 'correlation-1',
  resolveModule: (moduleKey: string) => ({ moduleKey }),
  isSupported: () => ({ supported: true }),
  generate: async (resource: (typeof descriptors)[number]) => ({ ...resource, count: 1 }),
}

test('one failing module does not abort successful module previews', async () => {
  const result = await generateIsolatedPreviews({
    ...base,
    requested: ['accounts', 'customers'],
    generate: async (resource) => {
      if (resource.key === 'accounts') throw new PreviewStageError('quickbooks_request', 'QBO_REQUEST_FAILED', 'Intuit rejected Account.')
      return { ...resource, count: 2 }
    },
  })
  assert.equal(result[0].status, 'error')
  assert.equal(result[1].status, 'success')
  assert.equal(result[0].stage, 'quickbooks_request')
})

test('unsupported modules return an unsupported result instead of throwing', async () => {
  const [result] = await generateIsolatedPreviews({
    ...base,
    requested: ['accounts'],
    isSupported: () => ({ supported: false, message: 'Not available in this QuickBooks edition.' }),
  })
  assert.equal(result.status, 'unsupported')
  assert.equal(result.errorCode, 'MODULE_UNSUPPORTED')
})

test('missing module registry entries are isolated and structured', async () => {
  const [result] = await generateIsolatedPreviews({
    ...base,
    requested: ['accounts'],
    resolveModule: () => { throw new Error('Unknown import/export module: accounts') },
  })
  assert.equal(result.status, 'error')
  assert.equal(result.stage, 'module_resolution')
  assert.equal(result.errorCode, 'MODULE_NOT_REGISTERED')
})

test('missing adapter resources are returned as structured module errors', async () => {
  const [result] = await generateIsolatedPreviews({ ...base, requested: ['missing-resource'] })
  assert.equal(result.status, 'error')
  assert.equal(result.stage, 'adapter_initialization')
  assert.equal(result.errorCode, 'ADAPTER_RESOURCE_MISSING')
})

test('provider initialization failures identify the provider lookup stage', async () => {
  const [result] = await generateIsolatedPreviews({
    ...base,
    requested: ['accounts'],
    generate: async () => { throw new PreviewStageError('provider_lookup', 'PROVIDER_NOT_FOUND', 'QuickBooks provider is unavailable.') },
  })
  assert.equal(result.status, 'error')
  assert.equal(result.stage, 'provider_lookup')
  assert.equal(result.errorCode, 'PROVIDER_NOT_FOUND')
})

test('a mixed preview returns successful, failed, and unsupported module results', async () => {
  const resources = [...descriptors, { key: 'budgets', label: 'Budgets', moduleKey: 'qb-budgets' }]
  const result = await generateIsolatedPreviews({
    ...base,
    resources,
    requested: ['accounts', 'customers', 'budgets'],
    isSupported: (resourceKey) => ({ supported: resourceKey !== 'budgets' }),
    generate: async (resource) => {
      if (resource.key === 'customers') throw new Error('Customer preview failed.')
      return { ...resource, count: 1 }
    },
  })
  assert.deepEqual(result.map((item) => item.status), ['success', 'error', 'unsupported'])
})

test('independent module previews use bounded concurrency and retain request order', async () => {
  const resources = Array.from({ length: 7 }, (_, index) => ({ key: `module-${index}`, label: `Module ${index}`, moduleKey: `module-${index}` }))
  let active = 0
  let maximumActive = 0
  const result = await generateIsolatedPreviews({
    ...base,
    resources,
    requested: resources.map((resource) => resource.key),
    concurrency: 3,
    generate: async (resource) => {
      active += 1
      maximumActive = Math.max(maximumActive, active)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active -= 1
      return { ...resource, count: 1 }
    },
  })
  assert.equal(maximumActive, 3)
  assert.deepEqual(result.map((item) => item.key), resources.map((resource) => resource.key))
})

test('QuickBooks preview exposes one bounded customer-payment path', async () => {
  const calls = { count: 0, records: 0 }
  const provider = {
    getEntityCount: async (_context: unknown, entity: string) => {
      calls.count += 1
      assert.equal(entity, 'Payment')
      return 250_000
    },
    getEntityRecords: async (_context: unknown, entity: string, options: { pageSize?: number; maxRecords?: number }) => {
      calls.records += 1
      assert.equal(entity, 'Payment')
      assert.equal(options.pageSize, 10)
      assert.equal(options.maxRecords, 10)
      return Array.from({ length: 10 }, (_, index) => ({ Id: String(index + 1), TotalAmt: 10 }))
    },
  } as unknown as AccountingProvider
  const adapter = new QuickBooksImportAdapter()
  const cache = new Map<string, Promise<SourcePreviewBatch>>()
  const context = { accessToken: 'token', realmId: 'realm' }
  const customerPayments = await adapter.fetchResource(provider, context, 'customer-payments', { preview: { sampleSize: 10, cache } })
  assert.deepEqual(calls, { count: 1, records: 1 })
  assert.equal(customerPayments.totalCount, 250_000)
  assert.equal(customerPayments.rows.length, 10)
  assert.equal(customerPayments.sampled, true)
})

test('QuickBooks provider stops pagination at the preview record limit', async () => {
  const requestedQueries: string[] = []
  const provider = new QuickBooksIntegrationService({
    clientId: 'client',
    clientSecret: 'secret',
    redirectUri: 'https://example.test/callback',
    environment: 'sandbox',
  }, async (input) => {
    const url = new URL(String(input))
    requestedQueries.push(url.searchParams.get('query') ?? '')
    return new Response(JSON.stringify({
      QueryResponse: { Invoice: Array.from({ length: 10 }, (_, index) => ({ Id: String(index + 1) })) },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  })
  const rows = await provider.getEntityRecords({ accessToken: 'token', realmId: '123' }, 'Invoice', {
    pageSize: 10,
    maxRecords: 10,
  })
  assert.equal(rows.length, 10)
  assert.equal(requestedQueries.length, 1)
  assert.match(requestedQueries[0], /MAXRESULTS 10/)
})

test('QuickBooks provider can stop after one resumable extraction page', async () => {
  let requests = 0
  const provider = new QuickBooksIntegrationService({
    clientId: 'client', clientSecret: 'secret', redirectUri: 'https://example.test/callback', environment: 'sandbox',
  }, async () => {
    requests += 1
    return new Response(JSON.stringify({ QueryResponse: { Invoice: Array.from({ length: 100 }, (_, index) => ({ Id: String(index + 1) })) } }), { status: 200 })
  })
  const rows = await provider.getEntityRecords({ accessToken: 'token', realmId: '123' }, 'Invoice', { pageSize: 100, maxPages: 1, onPage: async () => undefined })
  assert.equal(rows.length, 100)
  assert.equal(requests, 1)
})

test('attachment preview returns metadata without downloading file content', async () => {
  let downloads = 0
  const provider = {
    getEntityCount: async () => 1,
    getEntityRecords: async () => [{ Id: 'attachment-1', FileName: 'receipt.pdf' }],
    downloadAttachment: async () => {
      downloads += 1
      throw new Error('Preview must not download attachments.')
    },
  } as unknown as AccountingProvider
  const resource = await new QuickBooksImportAdapter().fetchResource(
    provider,
    { accessToken: 'token', realmId: 'realm' },
    'attachments',
    { companyId: 'company', preview: { sampleSize: 10, cache: new Map() } },
  )
  assert.equal(resource.rows.length, 1)
  assert.equal(downloads, 0)
})

test('preview profiler reports API/query counts, repeats, per-module timing, and N+1 candidates', () => {
  const profiler = new PreviewProfiler(3, 10)
  profiler.stage('preview_generation', 'started', 'customers')
  profiler.request({ kind: 'quickbooks', module: 'customers', method: 'GET', endpoint: 'quickbooks.api/query', signature: 'qbo-1', durationMs: 25, status: 200 })
  for (let index = 0; index < 3; index += 1) {
    profiler.request({ kind: 'supabase', module: 'customers', method: 'GET', endpoint: 'db/rest', signature: 'db-1', durationMs: 2, status: 200 })
  }
  profiler.result('customers', 10, 100)
  profiler.stage('preview_generation', 'completed', 'customers')
  const report = profiler.report()
  assert.equal(report.quickBooksApiCalls, 1)
  assert.equal(report.supabaseQueries, 3)
  assert.equal(report.modules[0].rowsFetched, 10)
  assert.equal(report.repeatedRequests[0].count, 3)
  assert.deepEqual(report.nPlusOneCandidates, [{ module: 'customers', supabaseQueries: 3 }])
})

test('every Migration Wizard QuickBooks module has registry, adapter, provider, and preview mappings', () => {
  const catalog = new Set(MODULE_CATALOG.map((module) => module.key))
  const adapter = new QuickBooksImportAdapter()
  const missing = adapter.resources.flatMap((resource) => {
    const support = getQuickBooksPreviewSupport(resource.key)
    const gaps = []
    if (!catalog.has(resource.moduleKey as (typeof MODULE_CATALOG)[number]['key'])) gaps.push('registry')
    if (!support.supported) gaps.push('provider/preview')
    return gaps.map((gap) => `${resource.key}:${gap}`)
  })
  assert.deepEqual(missing, [])
})

test('preview session bypasses checkpoints and staging and resolves the connection once', () => {
  const source = readFileSync('src/lib/import-export/sources/source-registry.ts', 'utf8')
  const start = source.indexOf('export async function withSourcePreviewSession')
  const end = source.indexOf('export async function fetchSourceResource', start)
  const previewSession = source.slice(start, end)
  assert.doesNotMatch(previewSession, /quickbooks_migration_checkpoints/)
  assert.doesNotMatch(previewSession, /quickbooks_extraction_staging/)
  assert.equal((previewSession.match(/executeForProvider/g) ?? []).length, 1)
  assert.match(previewSession, /preview: \{ sampleSize, cache \}/)
})
