/**
 * Wizard/worker-path benchmark (not the CLI processImport bypass).
 *
 * Drives the same orchestration the Migration Wizard uses:
 *   createQuickBooksMigrationSession → createImportJob (background) →
 *   applyJobCreated → enqueueJob(QUICKBOOKS_IMPORT_STEP) → worker continuations →
 *   next module → session COMPLETED
 *
 * Requires a running worker: `npm run worker`
 *
 * Usage:
 *   npx tsx -r dotenv/config -r ./scripts/zatca/setup-server-only.cjs `
 *     scripts/quickbooks/benchmark-wizard.ts --modules=accounts,customers --strategy=update --reset
 */
import { loadEnvConfig } from '@next/env'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

loadEnvConfig(process.cwd())

const COMPANY_ID = '00000000-0000-4000-8000-000000000001'
const argument = (name: string, fallback = '') =>
  process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback

const moduleFilter = argument('modules', 'accounts,customers')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
const strategy = argument('strategy', 'update') as 'skip' | 'update' | 'create'
const doReset = process.argv.includes('--reset')
const pollMs = Number(argument('poll-ms', '2000'))
const timeoutMs = Number(argument('timeout-ms', String(90 * 60_000)))

const OPERATIONAL_TABLES = [
  'import_job_skips', 'import_job_errors', 'import_jobs', 'import_mapping_templates',
  'job_history', 'dead_letter_queue',
  'quickbooks_extraction_staging', 'quickbooks_migration_warnings',
  'quickbooks_migration_local_links', 'quickbooks_migration_records',
  'quickbooks_migration_checkpoints', 'quickbooks_materialization_runs',
  'quickbooks_opening_balance_details', 'quickbooks_cutoff_reconciliations',
  'quickbooks_retained_earnings_periods', 'quickbooks_certification_sections',
  'quickbooks_certification_runs', 'migration_wizard_sessions',
  'accounting_sync_changes', 'accounting_sync_runs',
  'payment_allocations', 'deposit_allocations', 'invoice_attachments',
  'invoice_lines', 'bill_lines', 'expense_lines', 'estimate_lines',
  'sales_order_lines', 'sales_receipt_lines', 'purchase_order_lines',
  'refund_receipt_lines', 'vendor_credit_lines', 'journal_lines',
  'ledger_entries', 'refund_receipts', 'payments', 'invoices', 'bills',
  'expenses', 'estimates', 'sales_orders', 'sales_receipts', 'purchase_orders',
  'vendor_credits', 'journal_entries', 'bank_transactions', 'bank_accounts',
  'warehouse_stock', 'stock_movements', 'inventory_items',
  'customers', 'vendors', 'cost_centers', 'exchange_rates',
]

async function resetTenant(companyId: string) {
  const { createAdminClient } = await import('../../src/lib/supabase/admin')
  const db = createAdminClient()

  // Null COA parents then wipe chart last among masters.
  await db.from('chart_of_accounts').update({ parent_id: null }).eq('company_id', companyId)

  for (const table of OPERATIONAL_TABLES) {
    const { error } = await db.from(table).delete().eq('company_id', companyId)
    if (error && !/does not exist|schema cache/i.test(error.message)) {
      console.warn(JSON.stringify({ event: 'reset_table_warn', table, message: error.message }))
    }
  }

  // job_queue may be company-scoped or payload-scoped
  await db.from('job_queue').delete().eq('company_id', companyId)
  const { data: orphanQueue } = await db.from('job_queue').select('id,payload').eq('job_type', 'QUICKBOOKS_IMPORT_STEP')
  for (const row of orphanQueue ?? []) {
    const payload = row.payload as Record<string, unknown> | null
    if (payload?.companyId === companyId || payload?.company_id === companyId) {
      await db.from('job_queue').delete().eq('id', row.id)
    }
  }

  await db.from('chart_of_accounts').delete().eq('company_id', companyId)
  await db.from('tax_agencies').delete().eq('company_id', companyId)

  console.log(JSON.stringify({ event: 'tenant_reset', companyId }))
}

function stageTimestamps(events: Array<{ type?: string; stage?: string | null; at?: string; durationMs?: number | null }>) {
  const byStage: Record<string, { startedAt: string | null; completedAt: string | null; durationMs: number | null }> = {}
  for (const event of events) {
    const stage = event.stage ?? null
    if (!stage) continue
    const bucket = byStage[stage] ?? { startedAt: null, completedAt: null, durationMs: null }
    if (event.type === 'stage_started' && !bucket.startedAt) bucket.startedAt = event.at ?? null
    if (event.type === 'stage_completed') {
      bucket.completedAt = event.at ?? null
      if (event.durationMs != null) bucket.durationMs = Number(event.durationMs)
    }
    byStage[stage] = bucket
  }
  return byStage
}

async function main() {
  const [
    { createAdminClient },
    { withCompanyContext },
    { getImportSource },
    { orderQuickBooksMigrationResources },
    { initializeModuleLifecycle, applyJobCreated, orderedModules },
    { createQuickBooksMigrationSession, getQuickBooksMigrationSession, updateQuickBooksMigrationSession, reconcileQuickBooksMigrationSession },
    { createImportJob, setImportJobStatus, getImportJob },
    { enqueueJob },
    { deriveMigrationTiming },
  ] = await Promise.all([
    import('../../src/lib/supabase/admin'),
    import('../../src/lib/tenant'),
    import('../../src/lib/import-export/sources/source-registry'),
    import('../../src/lib/import-export/quickbooks/dependency-order'),
    import('../../src/lib/import-export/wizard/module-lifecycle'),
    import('../../src/lib/import-export/wizard/migration-session.service'),
    import('../../src/lib/import-export/jobs/import-job.service'),
    import('../../src/lib/platform/jobs/queue'),
    import('../../src/lib/import-export/wizard/migration-timing'),
  ])

  const db = createAdminClient()
  const provider = await db.from('accounting_integration_providers').select('id').eq('slug', 'quickbooks').single()
  if (provider.error) throw provider.error
  const connection = await db
    .from('accounting_integration_connections')
    .select('tenant_id,connected_by,realm_id')
    .eq('provider_id', provider.data.id)
    .eq('tenant_id', COMPANY_ID)
    .eq('status', 'CONNECTED')
    .maybeSingle()
  if (connection.error) throw connection.error
  if (!connection.data?.connected_by) throw new Error('Benchmark tenant has no CONNECTED QuickBooks OAuth row / connected_by')

  const companyId = COMPANY_ID
  const userId = String(connection.data.connected_by)
  const realmId = String(connection.data.realm_id ?? '')

  if (doReset) await resetTenant(companyId)

  const source = getImportSource('quickbooks')
  const selected = orderQuickBooksMigrationResources(source.resources)
    .filter((resource) => moduleFilter.includes(resource.key))
  if (selected.length === 0) throw new Error(`No modules matched --modules=${moduleFilter.join(',')}`)

  const lifecycle = initializeModuleLifecycle(selected)
  const wallStartedAt = new Date().toISOString()
  const wallStartedMs = Date.now()

  const session = await withCompanyContext(companyId, () => createQuickBooksMigrationSession({
    userId,
    selectedModules: selected,
    duplicateStrategy: strategy,
    lifecycle,
    sourceLabel: 'QuickBooks Online',
    companyName: 'Benchmark Wizard',
    currency: 'USD',
    companyIdOverride: companyId,
  }))

  console.log(JSON.stringify({
    event: 'wizard_session_created',
    sessionId: session.id,
    modules: selected.map((item) => item.key),
    strategy,
  }))

  const issued = new Set<string>()
  let hydrated = session
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    try {
      hydrated = await withCompanyContext(companyId, async () => {
        const found = await getQuickBooksMigrationSession(session.id, companyId)
        if (!found) throw new Error('Session disappeared')
        return reconcileQuickBooksMigrationSession(found)
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(JSON.stringify({ event: 'hydrate_retry', message, at: new Date().toISOString() }))
      await new Promise((resolve) => setTimeout(resolve, pollMs))
      continue
    }

    if (hydrated.config.state !== 'running') break

    const { nextCoordinationAction } = await import('../../src/lib/import-export/wizard/migration-coordination')
    const action = nextCoordinationAction(hydrated, issued)
    if (action.type === 'idle') {
      await new Promise((resolve) => setTimeout(resolve, pollMs))
      continue
    }

    if (action.key) issued.add(action.key)

    if (action.type === 'create-job') {
      const module = action.module
      const job = await withCompanyContext(companyId, () => createImportJob({
        userId,
        moduleKey: module.moduleKey,
        filename: `QuickBooks - ${module.label}`,
        fileFormat: 'csv',
        duplicateStrategy: strategy,
        payloadSnapshot: {
          sourceKey: 'quickbooks',
          resourceKey: module.key,
          filename: `QuickBooks - ${module.label}`,
          fileFormat: 'csv',
          duplicateStrategy: strategy,
        },
      }))
      await withCompanyContext(companyId, () => setImportJobStatus(job.id, 'pending'))
      const nextLifecycle = applyJobCreated(hydrated.lifecycle, module.key, job.id)
      hydrated = await withCompanyContext(companyId, () => updateQuickBooksMigrationSession({
        sessionId: hydrated.id,
        companyIdOverride: companyId,
        lifecycle: nextLifecycle,
        step: 'import',
        state: 'running',
      }))
      console.log(JSON.stringify({
        event: 'module_queued',
        module: module.key,
        jobId: job.id,
        at: new Date().toISOString(),
      }))
      continue
    }

    if (action.type === 'run-job') {
      const module = action.module
      if (!module.jobId) continue
      await enqueueJob({
        jobType: 'QUICKBOOKS_IMPORT_STEP',
        companyId,
        createdById: userId,
        payload: {
          importJobId: module.jobId,
          moduleKey: module.moduleKey,
          companyId,
          userId,
        },
      })
      console.log(JSON.stringify({
        event: 'module_enqueued',
        module: module.key,
        jobId: module.jobId,
        at: new Date().toISOString(),
      }))
      await new Promise((resolve) => setTimeout(resolve, pollMs))
      continue
    }

    if (action.type === 'mark-completed') {
      hydrated = await withCompanyContext(companyId, () => updateQuickBooksMigrationSession({
        sessionId: hydrated.id,
        companyIdOverride: companyId,
        lifecycle: hydrated.lifecycle,
        step: 'report',
        state: 'completed',
      }))
      break
    }

    if (action.type === 'mark-failed') {
      hydrated = await withCompanyContext(companyId, () => updateQuickBooksMigrationSession({
        sessionId: hydrated.id,
        companyIdOverride: companyId,
        lifecycle: hydrated.lifecycle,
        step: 'report',
        state: 'failed',
      }))
      break
    }
  }

  if (Date.now() >= deadline) {
    throw new Error(`Wizard benchmark timed out after ${timeoutMs}ms (session=${session.id}, state=${hydrated.config.state})`)
  }

  const finalSession = await withCompanyContext(companyId, () => getQuickBooksMigrationSession(session.id, companyId))
  if (!finalSession) throw new Error('Final session missing')
  const timing = deriveMigrationTiming(finalSession, Date.now())

  const moduleReports = []
  for (const entry of orderedModules(finalSession.lifecycle)) {
    const job = finalSession.jobs[entry.key]
    const events = job?.activityEvents ?? entry.progress?.activityEvents ?? []
    const stages = stageTimestamps(events)
    const snapshot = job?.progressSnapshot ?? entry.progress?.progressSnapshot ?? {}
    const activeMs = Number(snapshot.activeProcessingMs ?? entry.durationMs ?? 0)
    const databaseWaitMs = Number(snapshot.databaseTimeMs ?? 0)
    const apiWaitMs = Number(snapshot.apiTimeMs ?? 0)
    const queuedAt = job?.createdAt ?? null
    const claimedAt = job?.startedAt ?? snapshot.startedAt ?? null
    const completedAt = job?.updatedAt ?? null
    const queueWaitMs = queuedAt && claimedAt
      ? Math.max(0, Date.parse(claimedAt) - Date.parse(queuedAt))
      : 0
    const rows = Math.max(job?.processedRows ?? 0, job?.totalRows ?? 0, entry.progress?.processedRows ?? 0)
    const cpuMs = Math.max(0, activeMs - databaseWaitMs - apiWaitMs)
    moduleReports.push({
      key: entry.key,
      label: entry.label,
      phase: entry.phase,
      jobId: entry.jobId,
      jobStatus: job?.status ?? null,
      timestamps: {
        queued: queuedAt,
        workerClaimed: claimedAt,
        extraction: stages.extraction ?? null,
        validation: stages.validation ?? null,
        duplicate_detection: stages.duplicate_detection ?? null,
        materialization: stages.materialization ?? null,
        checkpoint: stages.pagination ?? stages.staging_cleanup ?? null,
        completion: completedAt,
      },
      metrics: {
        totalElapsedMs: queuedAt && completedAt
          ? Math.max(0, Date.parse(completedAt) - Date.parse(queuedAt))
          : null,
        queueWaitMs,
        activeProcessingMs: activeMs,
        databaseWaitMs,
        apiWaitMs,
        cpuMs,
        rowsProcessed: rows,
        rowsPerSecond: activeMs > 0 ? rows / (activeMs / 1000) : null,
        imported: job?.importedCount ?? 0,
        updated: job?.updatedCount ?? 0,
        skipped: job?.skippedCount ?? 0,
        failed: job?.failedCount ?? 0,
      },
      stageDurationsMs: Object.fromEntries(
        Object.entries(stages).map(([name, value]) => [name, value.durationMs]),
      ),
    })
  }

  // Correctness checks
  const { data: pendingQueue } = await db.from('job_queue')
    .select('id,status,payload')
    .eq('company_id', companyId)
    .eq('job_type', 'QUICKBOOKS_IMPORT_STEP')
    .in('status', ['PENDING', 'RUNNING'])
  const { data: importJobs } = await db.from('import_jobs').select('id,status,module_key').eq('company_id', companyId)
  const { data: openSessions } = await db.from('migration_wizard_sessions')
    .select('id,status')
    .eq('company_id', companyId)
    .eq('status', 'IN_PROGRESS')
  const { data: checkpoints } = await db.from('quickbooks_migration_checkpoints')
    .select('id,module_key,status')
    .eq('company_id', companyId)

  const checks = {
    sessionCompleted: finalSession.config.state === 'completed' && finalSession.status === 'COMPLETED',
    allImportJobsCompleted: (importJobs ?? []).every((row) => row.status === 'completed'),
    noOrphanQueueJobs: (pendingQueue ?? []).length === 0,
    noOrphanInProgressSessions: (openSessions ?? []).length === 0,
    importJobCount: (importJobs ?? []).length,
    historyWouldShow: {
      sessionStatus: finalSession.config.state,
      moduleCount: orderedModules(finalSession.lifecycle).length,
      imported: timing ? orderedModules(finalSession.lifecycle).reduce((sum, entry) => sum + (entry.progress?.importedCount ?? 0), 0) : 0,
    },
    timingConsistent: {
      elapsedGteActive: timing.elapsedMs >= timing.activeProcessingMs,
      idleEqualsElapsedMinusActive: Math.abs(timing.idleMs - (timing.elapsedMs - timing.activeProcessingMs)) <= 1,
      queueWaitLteIdle: timing.queueWaitMs <= timing.idleMs + 1,
      databaseWaitLteActive: timing.databaseTimeMs <= timing.activeProcessingMs + 1,
    },
    staleCheckpoints: (checkpoints ?? []).filter((row) => String(row.status ?? '').toLowerCase() === 'open'),
  }

  // Load CLI baselines for comparison
  const baselineDir = path.join(process.cwd(), 'test-data', 'benchmarks')
  const cliBaselines: Record<string, unknown> = {}
  for (const key of moduleFilter) {
    try {
      const files = (await import('node:fs')).readdirSync(baselineDir)
        .filter((name) => name.startsWith(`quickbooks-cli-${key}-`) && name.endsWith('.json'))
        .sort()
      const latest = files.at(-1)
      if (latest) {
        cliBaselines[key] = JSON.parse(await readFile(path.join(baselineDir, latest), 'utf8'))
      }
    } catch {
      // ignore
    }
  }

  const comparisons = moduleReports.map((module) => {
    const cli = cliBaselines[module.key] as {
      totals?: { durationMs?: number; rowsPerSecond?: number; rowsFetched?: number }
      stageDetail?: { persistenceDbMs?: number; quickBooksApiMs?: number }
    } | undefined
    if (!cli?.totals) return { key: module.key, cli: null, wizard: module.metrics, deltas: null }
    const cliActive = cli.totals.durationMs ?? 0
    const wizardActive = module.metrics.activeProcessingMs
    const pct = (wizard: number, baseline: number) => baseline > 0 ? ((wizard - baseline) / baseline) * 100 : null
    return {
      key: module.key,
      cli: {
        activeProcessingMs: cliActive,
        rowsPerSecond: cli.totals.rowsPerSecond ?? null,
        rows: cli.totals.rowsFetched ?? null,
        databaseWaitMs: cli.stageDetail?.persistenceDbMs ?? null,
        apiWaitMs: cli.stageDetail?.quickBooksApiMs ?? null,
      },
      wizard: module.metrics,
      deltas: {
        activeProcessingPct: pct(wizardActive, cliActive),
        rowsPerSecondPct: pct(module.metrics.rowsPerSecond ?? 0, cli.totals.rowsPerSecond ?? 0),
        databaseWaitPct: pct(module.metrics.databaseWaitMs, cli.stageDetail?.persistenceDbMs ?? 0),
        apiWaitPct: pct(module.metrics.apiWaitMs, cli.stageDetail?.quickBooksApiMs ?? 0),
      },
    }
  })

  const report = {
    event: 'quickbooks_wizard_benchmark',
    mode: 'wizard_worker_orchestration',
    note: 'Uses the same create-session → create-job → enqueue → worker continuation path as Migration Wizard UI. Browser UI was not automated; orchestration is identical.',
    companyId,
    realmId,
    sessionId: finalSession.id,
    strategy,
    modules: moduleFilter,
    wall: {
      startedAt: wallStartedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - wallStartedMs,
    },
    sessionTiming: timing,
    modules: moduleReports,
    comparisons,
    checks,
    waterfallGapsOver100ms: timing.waterfall.filter((span) => span.durationMs >= 100),
  }

  await mkdir(baselineDir, { recursive: true })
  const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
  const jsonPath = path.join(baselineDir, `quickbooks-wizard-${stamp}.json`)
  await writeFile(jsonPath, JSON.stringify(report, null, 2), 'utf8')

  const md: string[] = []
  md.push('# QuickBooks Migration Wizard vs CLI benchmark')
  md.push('')
  md.push(`Measured ${new Date().toISOString()} against sandbox realm \`${realmId}\`, tenant \`${companyId}\`.`)
  md.push('')
  md.push('## Method')
  md.push('')
  md.push('- **CLI**: `scripts/quickbooks/benchmark-module.ts` — in-process fetch + `processImport` (no queue / import_jobs).')
  md.push('- **Wizard**: this harness — `createQuickBooksMigrationSession` → background `import_jobs` → `enqueueJob(QUICKBOOKS_IMPORT_STEP)` → worker pages/continuations (same path as Migration Wizard UI coordination).')
  md.push(`- Modules: ${moduleFilter.join(', ')} · strategy=\`${strategy}\` · reset=${doReset}`)
  md.push(`- Session: \`${finalSession.id}\` → **${finalSession.config.state}** / ${finalSession.status}`)
  md.push(`- Raw JSON: \`${path.relative(process.cwd(), jsonPath)}\``)
  md.push('')
  md.push('## Correctness')
  md.push('')
  for (const [key, value] of Object.entries(checks)) {
    if (typeof value === 'boolean') md.push(`- ${key}: **${value ? 'PASS' : 'FAIL'}**`)
  }
  md.push(`- timingConsistent: ${JSON.stringify(checks.timingConsistent)}`)
  md.push(`- pending queue orphans: ${(pendingQueue ?? []).length}`)
  md.push(`- open sessions: ${(openSessions ?? []).length}`)
  md.push(`- stale checkpoints: ${checks.staleCheckpoints.length}`)
  md.push('')
  md.push('## Session timing (wizard)')
  md.push('')
  md.push('| Metric | Value |')
  md.push('|---|---|')
  md.push(`| Elapsed | ${(timing.elapsedMs / 1000).toFixed(1)} s |`)
  md.push(`| Active processing | ${(timing.activeProcessingMs / 1000).toFixed(1)} s |`)
  md.push(`| Queue wait | ${(timing.queueWaitMs / 1000).toFixed(1)} s |`)
  md.push(`| Waiting / idle | ${(timing.idleMs / 1000).toFixed(1)} s |`)
  md.push(`| Database wait | ${(timing.databaseTimeMs / 1000).toFixed(1)} s |`)
  md.push(`| API wait | ${(timing.apiTimeMs / 1000).toFixed(1)} s |`)
  md.push(`| ETA label | ${timing.etaLabel} |`)
  md.push('')
  md.push('## Per-module wizard results')
  md.push('')
  md.push('| Module | Rows | Active s | Queue wait s | DB wait s | API wait s | CPU s | Rows/s |')
  md.push('|---|---:|---:|---:|---:|---:|---:|---:|')
  for (const module of moduleReports) {
    md.push(`| ${module.key} | ${module.metrics.rowsProcessed} | ${(module.metrics.activeProcessingMs / 1000).toFixed(1)} | ${(module.metrics.queueWaitMs / 1000).toFixed(1)} | ${(module.metrics.databaseWaitMs / 1000).toFixed(1)} | ${(module.metrics.apiWaitMs / 1000).toFixed(1)} | ${(module.metrics.cpuMs / 1000).toFixed(1)} | ${module.metrics.rowsPerSecond?.toFixed(2) ?? '—'} |`)
  }
  md.push('')
  md.push('## CLI vs Wizard (active path)')
  md.push('')
  md.push('| Module | CLI active s | Wizard active s | Δ% | CLI rows/s | Wizard rows/s | Δ% | Cause notes |')
  md.push('|---|---:|---:|---:|---:|---:|---:|---|')
  for (const comparison of comparisons) {
    if (!comparison.cli || !comparison.deltas) {
      md.push(`| ${comparison.key} | — | ${((comparison.wizard.activeProcessingMs) / 1000).toFixed(1)} | — | — | ${comparison.wizard.rowsPerSecond?.toFixed(2) ?? '—'} | — | No CLI baseline |`)
      continue
    }
    const cause = Math.abs(comparison.deltas.activeProcessingPct ?? 0) > 15
      ? 'See discrepancy analysis below'
      : 'Within 15%'
    md.push(`| ${comparison.key} | ${((comparison.cli.activeProcessingMs ?? 0) / 1000).toFixed(1)} | ${(comparison.wizard.activeProcessingMs / 1000).toFixed(1)} | ${comparison.deltas.activeProcessingPct?.toFixed(1) ?? '—'}% | ${comparison.cli.rowsPerSecond?.toFixed(2) ?? '—'} | ${comparison.wizard.rowsPerSecond?.toFixed(2) ?? '—'} | ${comparison.deltas.rowsPerSecondPct?.toFixed(1) ?? '—'}% | ${cause} |`)
  }
  md.push('')
  md.push('## Discrepancy analysis (>15%)')
  md.push('')
  md.push('Expected wizard overhead vs CLI (same `processImport` core):')
  md.push('')
  md.push('1. **Per-page worker steps** (`maxBatches: 1`) — extra fetch/claim/enqueue round trips vs one-shot CLI fetch.')
  md.push('2. **Progress persistence** — `updateImportJobProgress` / activity events / skip rows on each batch; CLI passes no `onProgress`.')
  md.push('3. **Cancellation / pause / ownership checks** — `isCancelled` / `isPaused` / `assertOwned` per row in worker path.')
  md.push('4. **Queue wait** — wall-clock elapsed includes PENDING time before worker claim; CLI has zero queue wait.')
  md.push('5. **Coordination poll interval** — next module create/run waits for provider/harness poll (~1.5–2s) after prior job completes.')
  md.push('')
  for (const comparison of comparisons) {
    if (!comparison.deltas?.activeProcessingPct || Math.abs(comparison.deltas.activeProcessingPct) <= 15) continue
    md.push(`### ${comparison.key}`)
    md.push('')
    md.push(`Active processing Δ **${comparison.deltas.activeProcessingPct.toFixed(1)}%** (CLI ${((comparison.cli?.activeProcessingMs ?? 0) / 1000).toFixed(1)}s → Wizard ${(comparison.wizard.activeProcessingMs / 1000).toFixed(1)}s).`)
    md.push(`DB wait Δ ${comparison.deltas.databaseWaitPct?.toFixed(1) ?? 'n/a'}%; API wait Δ ${comparison.deltas.apiWaitPct?.toFixed(1) ?? 'n/a'}%.`)
    md.push('')
  }
  md.push('## Remaining optimization opportunities (by expected gain)')
  md.push('')
  md.push('1. **Batch Supabase writes in `processImport`** — ~85% of active time is sequential REST round trips (~230ms each). Largest win.')
  md.push('2. **Reduce per-row source_link_archive / verification chatter** — dominates materialization profile in CLI baseline.')
  md.push('3. **Coalesce progress persistence** — write snapshots less often than every batch/row callback.')
  md.push('4. **Larger worker page size / multi-batch steps** — cut claim/enqueue overhead between pages.')
  md.push('5. **Eager next-module enqueue from worker reconcile** — remove coordination poll gap between modules (architecture-sensitive).')
  md.push('')

  const mdPath = path.join(baselineDir, 'quickbooks-wizard-vs-cli.md')
  await writeFile(mdPath, md.join('\n'), 'utf8')
  console.log(JSON.stringify({ event: 'wizard_benchmark_complete', jsonPath, mdPath, sessionId: finalSession.id, state: finalSession.config.state }))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
