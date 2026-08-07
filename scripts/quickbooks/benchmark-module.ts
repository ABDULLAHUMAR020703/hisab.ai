/**
 * Benchmark-only CLI baseline for a single QuickBooks module.
 *
 * Runs the same functions the sandbox migration CLI runs
 * (`scripts/quickbooks/run-live-sandbox-migration.ts`) and times each stage, so
 * the result can later be compared against the background worker and the
 * Migration Wizard. Nothing here is imported by application code: all timing
 * comes from existing hooks (`SourceFetchDiagnostics.onStage`, `MigrationTrace`,
 * `QUICKBOOKS_PERFORMANCE_MODE`) plus a process-local `fetch` wrapper installed
 * by this script only.
 *
 * Usage:
 *   npx tsx -r dotenv/config -r ./scripts/zatca/setup-server-only.cjs \
 *     scripts/quickbooks/benchmark-module.ts --module=customers [--strategy=update] [--report]
 */
import { loadEnvConfig } from '@next/env'

loadEnvConfig(process.cwd())

// Enables MigrationTrace.measureOperation, which is otherwise inert.
process.env.QUICKBOOKS_PERFORMANCE_MODE = 'true'

const argument = (name: string, fallback = '') =>
  process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback

const moduleKey = argument('module', 'customers')
const strategy = argument('strategy', 'update') as 'skip' | 'update' | 'create'
const withReport = process.argv.includes('--report')
const batchSize = Number(argument('batch-size', '100'))

interface RequestSample {
  kind: 'quickbooks' | 'supabase' | 'auth' | 'other'
  target: string
  method: string
  startedAtMs: number
  durationMs: number
  status: number | null
  bytes: number
  rows: number | null
  entity: string | null
}

interface StageSample {
  name: string
  startedAtMs: number
  durationMs: number
}

const samples: RequestSample[] = []
const stages: StageSample[] = []
let instrumentationMs = 0
const t0 = performance.now()
const since = () => performance.now() - t0

function classify(rawUrl: string): { kind: RequestSample['kind']; target: string; entity: string | null } {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return { kind: 'other', target: rawUrl, entity: null }
  }
  if (url.hostname.includes('oauth.platform.intuit.com')) {
    return { kind: 'auth', target: `${url.hostname}${url.pathname}`, entity: null }
  }
  if (url.hostname.endsWith('.intuit.com')) {
    const query = url.searchParams.get('query') ?? ''
    const entity = /from\s+([A-Za-z]+)/i.exec(query)?.[1]
      ?? url.pathname.split('/').filter(Boolean).at(-1)
      ?? null
    return { kind: 'quickbooks', target: `${url.pathname.replace(/\/company\/\d+/, '/company/{realm}')}`, entity }
  }
  if (url.hostname.includes('supabase')) {
    const table = url.pathname.startsWith('/rest/v1/') ? url.pathname.slice('/rest/v1/'.length) : url.pathname
    return { kind: 'supabase', target: table, entity: table }
  }
  return { kind: 'other', target: `${url.hostname}${url.pathname}`, entity: null }
}

function countRows(body: string, entity: string | null): number | null {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>
    const queryResponse = parsed.QueryResponse
    if (queryResponse && typeof queryResponse === 'object') {
      const list = Object.entries(queryResponse as Record<string, unknown>)
        .find(([key, value]) => Array.isArray(value) && (!entity || key.toLowerCase() === entity.toLowerCase()))
      if (list) return (list[1] as unknown[]).length
      if ('totalCount' in (queryResponse as Record<string, unknown>)) return 0
    }
    return Array.isArray(parsed) ? parsed.length : null
  } catch {
    return null
  }
}

function installFetchInstrumentation() {
  const original = globalThis.fetch
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const rawUrl = input instanceof Request ? input.url : String(input)
    const { kind, target, entity } = classify(rawUrl)
    const method = String(init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    const startedAtMs = since()
    const startedAt = performance.now()
    try {
      const response = await original(input, init)
      const durationMs = performance.now() - startedAt
      // Body inspection happens after the measured window and is reported
      // separately so it never inflates a stage timing silently.
      const overheadStart = performance.now()
      let bytes = Number(response.headers.get('content-length') ?? 0)
      let rows: number | null = null
      if (kind === 'quickbooks') {
        const body = await response.clone().text()
        bytes = Buffer.byteLength(body)
        rows = countRows(body, entity)
      }
      instrumentationMs += performance.now() - overheadStart
      samples.push({ kind, target, method, startedAtMs, durationMs, status: response.status, bytes, rows, entity })
      return response
    } catch (error) {
      samples.push({ kind, target, method, startedAtMs, durationMs: performance.now() - startedAt, status: null, bytes: 0, rows: null, entity })
      throw error
    }
  }
}

async function stage<T>(name: string, operation: () => Promise<T> | T): Promise<T> {
  const startedAtMs = since()
  const startedAt = performance.now()
  try {
    return await operation()
  } finally {
    stages.push({ name, startedAtMs, durationMs: performance.now() - startedAt })
  }
}

function requestsWithin(startedAtMs: number, durationMs: number, predicate: (sample: RequestSample) => boolean) {
  const endsAtMs = startedAtMs + durationMs
  return samples.filter((sample) => sample.startedAtMs >= startedAtMs - 1 && sample.startedAtMs <= endsAtMs && predicate(sample))
}

const total = (list: RequestSample[]) => list.reduce((sum, sample) => sum + sample.durationMs, 0)

async function main() {
  installFetchInstrumentation()

  const [
    { getImportSource, fetchSourceResource },
    { getModuleDefinition },
    { coerceMappedRows, validateMappedRows },
    { detectDuplicates },
    { processImport },
    { MigrationTrace },
    { createAdminClient },
    { withCompanyContext },
  ] = await Promise.all([
    import('../../src/lib/import-export/sources/source-registry'),
    import('../../src/lib/import-export/registry/module-registry'),
    import('../../src/lib/import-export/validation/validation-engine'),
    import('../../src/lib/import-export/duplicate/duplicate-detector'),
    import('../../src/lib/import-export/import/import-processor'),
    import('../../src/lib/import-export/quickbooks/migration-telemetry'),
    import('../../src/lib/supabase/admin'),
    import('../../src/lib/tenant'),
  ])

  const db = createAdminClient()
  const provider = await db.from('accounting_integration_providers').select('id').eq('slug', 'quickbooks').single()
  if (provider.error) throw provider.error
  const connection = await db.from('accounting_integration_connections')
    .select('tenant_id,connected_by,realm_id')
    .eq('provider_id', provider.data.id).eq('status', 'CONNECTED')
    .order('updated_at', { ascending: false }).limit(1).single()
  if (connection.error) throw connection.error

  const companyId = String(connection.data.tenant_id)
  const userId = String(connection.data.connected_by)
  const resource = getImportSource('quickbooks').resources.find((item) => item.key === moduleKey)
  if (!resource) throw new Error(`Unknown QuickBooks resource: ${moduleKey}`)

  const startedAtIso = new Date().toISOString()
  const runStartedAt = performance.now()

  const result = await withCompanyContext(companyId, async () => {
    const connectionStages: Array<{ stage: string; state: string; atMs: number }> = []
    const normalized = await stage('fetch', () => fetchSourceResource(companyId, 'quickbooks', moduleKey, {
      onStage: (fetchStage, state) => connectionStages.push({ stage: fetchStage, state, atMs: since() }),
    }))

    const definition = getModuleDefinition(resource.moduleKey)
    const mapped = normalized.rows.map((row, index) => ({ rowNumber: index + 2, source: row, mapped: row }))
    const coerced = await stage('mapping', () => coerceMappedRows(mapped, definition.fields))
    const validation = await stage('validation', () => validateMappedRows(coerced, definition.fields))
    const validRows = coerced.filter((row) => validation.validRowNumbers.includes(row.rowNumber))

    const trace = new MigrationTrace(moduleKey)
    const ctx = { companyId, userId, performance: trace }
    const duplicateMatches = await stage('duplicate_detection', () => detectDuplicates(definition, validRows, ctx))
    const imported = await stage('import_processing', () => processImport({
      module: definition,
      rows: coerced,
      validation,
      duplicateStrategy: strategy,
      duplicateMatches,
      ctx,
      batchSize,
      trace,
    }))

    let reportMs = 0
    if (withReport) {
      const { buildQuickBooksMigrationReport } = await import('../../src/lib/import-export/quickbooks/migration-report-service')
      const reportStart = performance.now()
      await stage('report_generation', () => buildQuickBooksMigrationReport(companyId))
      reportMs = performance.now() - reportStart
    }

    const profile = await stage('finalize', () => trace.finish({
      fetched: normalized.rows.length,
      imported: imported.importedCount,
      updated: imported.updatedCount,
      skipped: imported.skippedCount,
      failed: imported.failedCount,
    }))

    return { normalized, validation, duplicateMatches, imported, profile, connectionStages, reportMs }
  })

  const totalMs = performance.now() - runStartedAt
  const fetchStage = stages.find((item) => item.name === 'fetch')!
  const importStage = stages.find((item) => item.name === 'import_processing')!

  const fetchApi = requestsWithin(fetchStage.startedAtMs, fetchStage.durationMs, (sample) => sample.kind === 'quickbooks')
  const authRequests = samples.filter((sample) => sample.kind === 'auth')
  const stagingWrites = requestsWithin(fetchStage.startedAtMs, fetchStage.durationMs, (sample) => sample.target === 'quickbooks_extraction_staging')
  const checkpointWrites = samples.filter((sample) => sample.target === 'quickbooks_migration_checkpoints')
  const importDb = requestsWithin(importStage.startedAtMs, importStage.durationMs, (sample) => sample.kind === 'supabase')
  const connectionLookup = (() => {
    const started = result.connectionStages.find((item) => item.stage === 'connection_lookup' && item.state === 'started')
    const completed = result.connectionStages.find((item) => item.stage === 'connection_lookup' && item.state === 'completed')
    return started && completed ? completed.atMs - started.atMs : null
  })()

  const rows = result.normalized.rows.length
  const perEntity = [...new Map(fetchApi.map((sample) => [sample.entity ?? sample.target, [] as RequestSample[]])).keys()]
    .map((entity) => {
      const group = fetchApi.filter((sample) => (sample.entity ?? sample.target) === entity)
      const rowsReturned = group.reduce((sum, sample) => sum + (sample.rows ?? 0), 0)
      return {
        entity,
        calls: group.length,
        totalMs: Math.round(total(group)),
        averageMs: Math.round(total(group) / group.length),
        slowestMs: Math.round(Math.max(...group.map((sample) => sample.durationMs))),
        rowsReturned,
        averageRowsPerCall: Math.round((rowsReturned / group.length) * 100) / 100,
        totalBytes: group.reduce((sum, sample) => sum + sample.bytes, 0),
        largestPayloadBytes: Math.max(...group.map((sample) => sample.bytes)),
      }
    })
    .sort((a, b) => b.totalMs - a.totalMs)

  const report = {
    event: 'quickbooks_cli_benchmark',
    module: moduleKey,
    moduleKey: resource.moduleKey,
    companyId,
    realmId: String(connection.data.realm_id),
    duplicateStrategy: strategy,
    batchSize,
    startedAt: startedAtIso,
    finishedAt: new Date().toISOString(),
    totals: {
      durationMs: Math.round(totalMs),
      rowsFetched: rows,
      validRows: result.validation.validRowNumbers.length,
      invalidRows: result.validation.invalidRowNumbers.length,
      imported: result.imported.importedCount,
      updated: result.imported.updatedCount,
      skipped: result.imported.skippedCount,
      failed: result.imported.failedCount,
      rowsPerSecond: Math.round((rows / (totalMs / 1000)) * 100) / 100,
      instrumentationOverheadMs: Math.round(instrumentationMs),
    },
    stages: stages.map((item) => ({
      name: item.name,
      durationMs: Math.round(item.durationMs),
      percentOfTotal: Math.round((item.durationMs / totalMs) * 10000) / 100,
    })),
    stageDetail: {
      authenticationMs: Math.round(connectionLookup ?? 0),
      authTokenRequests: authRequests.length,
      authTokenMs: Math.round(total(authRequests)),
      quickBooksApiMs: Math.round(total(fetchApi)),
      stagingWriteMs: Math.round(total(stagingWrites)),
      stagingWriteCalls: stagingWrites.length,
      checkpointMs: Math.round(total(checkpointWrites)),
      checkpointCalls: checkpointWrites.length,
      fetchOverheadMs: Math.round(fetchStage.durationMs - total(fetchApi) - total(stagingWrites) - total(checkpointWrites)),
      persistenceDbMs: Math.round(total(importDb)),
      persistenceDbCalls: importDb.length,
      persistenceOverheadMs: Math.round(importStage.durationMs - total(importDb)),
    },
    throughput: {
      fetchRowsPerSecond: Math.round((rows / (fetchStage.durationMs / 1000)) * 100) / 100,
      mappingRowsPerSecond: Math.round((rows / (stages.find((item) => item.name === 'mapping')!.durationMs / 1000)) * 100) / 100,
      validationRowsPerSecond: Math.round((rows / (stages.find((item) => item.name === 'validation')!.durationMs / 1000)) * 100) / 100,
      persistenceRowsPerSecond: Math.round((rows / (importStage.durationMs / 1000)) * 100) / 100,
      totalRowsPerSecond: Math.round((rows / (totalMs / 1000)) * 100) / 100,
    },
    api: {
      calls: fetchApi.length,
      totalMs: Math.round(total(fetchApi)),
      averageMs: fetchApi.length ? Math.round(total(fetchApi) / fetchApi.length) : 0,
      slowestMs: fetchApi.length ? Math.round(Math.max(...fetchApi.map((sample) => sample.durationMs))) : 0,
      totalBytes: fetchApi.reduce((sum, sample) => sum + sample.bytes, 0),
      perEntity,
    },
    database: {
      calls: samples.filter((sample) => sample.kind === 'supabase').length,
      totalMs: Math.round(total(samples.filter((sample) => sample.kind === 'supabase'))),
      perTable: [...new Set(samples.filter((sample) => sample.kind === 'supabase').map((sample) => sample.target))]
        .map((table) => {
          const group = samples.filter((sample) => sample.target === table)
          return { table, calls: group.length, totalMs: Math.round(total(group)), averageMs: Math.round(total(group) / group.length) }
        })
        .sort((a, b) => b.totalMs - a.totalMs),
    },
    operations: result.profile.slowestOperations ?? [],
    heap: {
      startBytes: result.profile.heapStartBytes,
      peakBytes: result.profile.heapPeakBytes,
      finishBytes: result.profile.heapFinishBytes,
    },
  }

  const { writeFile, mkdir } = await import('node:fs/promises')
  await mkdir('test-data/benchmarks', { recursive: true })
  const path = `test-data/benchmarks/quickbooks-cli-${moduleKey}-${startedAtIso.replace(/[:.]/g, '-')}.json`
  await writeFile(path, JSON.stringify(report, null, 2), 'utf8')
  console.log(JSON.stringify({ ...report, outputPath: path }, null, 2))
}

main().catch((error) => {
  console.error(JSON.stringify({
    event: 'quickbooks_cli_benchmark_failed',
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  }, null, 2))
  process.exitCode = 1
})
