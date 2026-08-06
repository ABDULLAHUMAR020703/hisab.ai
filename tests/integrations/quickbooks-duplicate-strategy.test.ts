import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import type { DuplicateMatch, DuplicateStrategy, MappedRow, ModuleDefinition, ValidationResult } from '../../src/lib/import-export/types'

// The processor is server-only; the same shim the PDF suite uses lets the test
// runner load it directly instead of asserting on source text alone.
const requireModule = createRequire(import.meta.url)
requireModule('../../scripts/zatca/setup-server-only.cjs')
const { processImport } = requireModule('../../src/lib/import-export/import/import-processor') as typeof import('../../src/lib/import-export/import/import-processor')

interface ModuleCalls {
  created: Record<string, unknown>[]
  updated: { id: string; record: Record<string, unknown> }[]
}

/**
 * A module with no accounting materialization config and rows without QuickBooks
 * raw payloads, so the strategy matrix runs without touching the database.
 */
function testModule(calls: ModuleCalls): ModuleDefinition {
  return {
    key: 'strategy-test',
    displayName: 'Strategy Test',
    fields: [{ key: 'name', label: 'Name', type: 'string' }],
    duplicateKeys: ['name'],
    async findDuplicate() { return null },
    async createRecord(record) { calls.created.push(record); return { id: `local-${calls.created.length}` } },
    async updateRecord(id, record) { calls.updated.push({ id, record }) },
    async exportRecords() { return [] },
    mapExportRow() { return {} },
  }
}

function rows(...names: string[]): MappedRow[] {
  return names.map((name, index) => ({ rowNumber: index + 1, source: { name }, mapped: { name } }))
}

function validationFor(mappedRows: MappedRow[]): ValidationResult {
  return {
    validRowNumbers: mappedRows.map((row) => row.rowNumber),
    invalidRowNumbers: [],
    issues: [],
    errorCount: 0,
    warningCount: 0,
    summaryByCode: {},
  }
}

async function runImport(input: {
  strategy: DuplicateStrategy
  mappedRows: MappedRow[]
  duplicateMatches?: DuplicateMatch[]
}) {
  const calls: ModuleCalls = { created: [], updated: [] }
  const result = await processImport({
    module: testModule(calls),
    rows: input.mappedRows,
    validation: validationFor(input.mappedRows),
    duplicateStrategy: input.strategy,
    duplicateMatches: input.duplicateMatches ?? [],
    ctx: { companyId: 'company-1', userId: 'user-1' },
  })
  return { result, calls }
}

const duplicate = (rowNumber: number, existingId: string): DuplicateMatch => ({
  rowNumber,
  existingId,
  matchedOn: ['name'],
})

test('a new record is created and counted as imported', async () => {
  const { result, calls } = await runImport({ strategy: 'update', mappedRows: rows('Fresh') })

  assert.deepEqual(
    [result.importedCount, result.updatedCount, result.skippedCount, result.failedCount],
    [1, 0, 0, 0],
  )
  assert.equal(calls.created.length, 1)
  assert.equal(calls.updated.length, 0)
})

test('ignore duplicates skips the existing record without updating it', async () => {
  const mappedRows = rows('Existing')
  const { result, calls } = await runImport({
    strategy: 'skip',
    mappedRows,
    duplicateMatches: [duplicate(1, 'local-existing')],
  })

  assert.deepEqual(
    [result.importedCount, result.updatedCount, result.skippedCount, result.failedCount],
    [0, 0, 1, 0],
  )
  assert.equal(calls.updated.length, 0)
  assert.deepEqual(result.skippedRecords.map((skip) => [skip.rowNumber, skip.reason, skip.existingRecordId]), [[1, 'duplicate', 'local-existing']])
})

test('update existing sends the record through the update path and counts it as updated', async () => {
  const { result, calls } = await runImport({
    strategy: 'update',
    mappedRows: rows('Existing'),
    duplicateMatches: [duplicate(1, 'local-existing')],
  })

  assert.deepEqual(
    [result.importedCount, result.updatedCount, result.skippedCount, result.failedCount],
    [0, 1, 0, 0],
  )
  assert.deepEqual(calls.updated, [{ id: 'local-existing', record: { name: 'Existing' } }])
  assert.deepEqual(result.skippedRecords, [])
})

test('update existing still updates when the incoming values match the existing record', async () => {
  // "Unchanged" is not a reason to skip once the user asked for an update: the
  // record must reach updateRecord and be reported as updated, not skipped.
  const { result, calls } = await runImport({
    strategy: 'update',
    mappedRows: rows('Unchanged Name'),
    duplicateMatches: [duplicate(1, 'local-unchanged')],
  })

  assert.equal(result.updatedCount, 1)
  assert.equal(result.skippedCount, 0)
  assert.deepEqual(calls.updated.map((call) => call.id), ['local-unchanged'])
})

test('replace existing creates a second record for non-provider rows', async () => {
  const { result, calls } = await runImport({
    strategy: 'create',
    mappedRows: rows('Existing'),
    duplicateMatches: [duplicate(1, 'local-existing')],
  })

  assert.deepEqual(
    [result.importedCount, result.updatedCount, result.skippedCount, result.failedCount],
    [1, 0, 0, 0],
  )
  assert.equal(calls.updated.length, 0)
  assert.equal(calls.created.length, 1)
})

test('replace existing merges into the linked record for QuickBooks rows', async () => {
  const mappedRows: MappedRow[] = [{ rowNumber: 1, source: { name: 'Existing' }, mapped: { name: 'Existing', _realmId: 'realm-1' } }]
  const { result, calls } = await runImport({
    strategy: 'create',
    mappedRows,
    duplicateMatches: [duplicate(1, 'local-existing')],
  })

  assert.equal(result.updatedCount, 1)
  assert.equal(result.importedCount, 0)
  assert.deepEqual(calls.updated.map((call) => call.id), ['local-existing'])
})

test('a mixed batch reports imported, updated, and skipped separately per strategy', async () => {
  const mappedRows = rows('New One', 'Existing One', 'New Two', 'Existing Two')
  const matches = [duplicate(2, 'local-2'), duplicate(4, 'local-4')]

  const updateRun = await runImport({ strategy: 'update', mappedRows, duplicateMatches: matches })
  assert.deepEqual(
    [updateRun.result.importedCount, updateRun.result.updatedCount, updateRun.result.skippedCount, updateRun.result.failedCount],
    [2, 2, 0, 0],
  )
  assert.deepEqual(updateRun.calls.updated.map((call) => call.id), ['local-2', 'local-4'])

  const skipRun = await runImport({ strategy: 'skip', mappedRows, duplicateMatches: matches })
  assert.deepEqual(
    [skipRun.result.importedCount, skipRun.result.updatedCount, skipRun.result.skippedCount, skipRun.result.failedCount],
    [2, 0, 2, 0],
  )
  assert.equal(skipRun.calls.updated.length, 0)
})

test('update existing never consults the unchanged-source shortcut', async () => {
  // Removing the Supabase configuration makes any database access observable as
  // a stage-tagged failure, so the reported stage proves which code ran. The
  // rows carry provider identity but no raw payload, so the only reachable
  // database calls are the source hash check and the post-update link check.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceUrl = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  delete process.env.NEXT_PUBLIC_SUPABASE_URL
  delete process.env.SUPABASE_URL
  delete process.env.SUPABASE_SERVICE_ROLE_KEY
  try {
    const mappedRows: MappedRow[] = [{
      rowNumber: 1,
      source: { name: 'Existing' },
      mapped: { name: 'Existing', _realmId: 'realm-1', _quickbooksEntity: 'Customer', _quickbooksId: 'qb-1' },
    }]

    const updateRun = await runImport({ strategy: 'update', mappedRows, duplicateMatches: [duplicate(1, 'local-existing')] })
    assert.deepEqual(updateRun.calls.updated.map((call) => call.id), ['local-existing'])
    assert.equal(updateRun.result.errors[0]?.details?.stage, 'source_link_verification')

    const skipRun = await runImport({ strategy: 'skip', mappedRows, duplicateMatches: [duplicate(1, 'local-existing')] })
    assert.equal(skipRun.calls.updated.length, 0)
    assert.equal(skipRun.result.errors[0]?.details?.stage, 'source_hash_check')
  } finally {
    if (url !== undefined) process.env.NEXT_PUBLIC_SUPABASE_URL = url
    if (serviceUrl !== undefined) process.env.SUPABASE_URL = serviceUrl
    if (key !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = key
  }
})

test('the unchanged-source shortcut is gated on the resolved duplicate action', () => {
  const processor = readFileSync('src/lib/import-export/import/import-processor.ts', 'utf8')
  const strategyIndex = processor.indexOf('applyDuplicateStrategy(input.duplicateStrategy')
  const hashCheckIndex = processor.indexOf("isQuickBooksRecordUnchanged(input.ctx.companyId")
  assert.ok(strategyIndex > 0 && hashCheckIndex > strategyIndex, 'the strategy must be resolved before the source hash check')
  assert.match(processor, /const sourceUnchanged = action === 'skip'/)
})
