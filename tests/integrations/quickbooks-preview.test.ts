import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { MODULE_CATALOG } from '../../src/lib/import-export/registry/module-catalog'
import { getQuickBooksPreviewSupport, QuickBooksImportAdapter } from '../../src/lib/import-export/sources/quickbooks.adapter'
import { generateIsolatedPreviews, PreviewStageError } from '../../src/lib/import-export/sources/preview-service'

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

test('preview reads checkpoints but bypasses staging mutation before the Intuit request', () => {
  const source = readFileSync('src/lib/import-export/sources/source-registry.ts', 'utf8')
  const previewBranch = source.indexOf('if (diagnostics?.preview)')
  const stagingDelete = source.indexOf("from('quickbooks_extraction_staging').delete()")
  assert.ok(previewBranch > source.indexOf("from('quickbooks_migration_checkpoints')"))
  assert.ok(previewBranch < stagingDelete)
  assert.match(source.slice(previewBranch, stagingDelete), /quickbooks_request/)
})
