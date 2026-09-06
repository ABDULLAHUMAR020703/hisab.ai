/**
 * Operator CLI for the immutable QuickBooks raw snapshot.
 *
 *   npx tsx -r dotenv/config -r ./scripts/zatca/setup-server-only.cjs \
 *     scripts/quickbooks/snapshot.ts <command> [options]
 *
 * Commands:
 *   create [--resources=a,b,c] [--drive]   Start a snapshot. --drive runs the
 *                                          extraction steps in-process to
 *                                          terminal instead of relying on a
 *                                          separate `npm run worker`.
 *   status <snapshotId>                    Print status + per-resource summary.
 *   report <snapshotId>                    Print the human-readable report.
 *   migrate <snapshotId> [--strategy=update]
 *                                          Create a snapshot-backed migration
 *                                          session (reads Storage, never QB).
 *                                          Requires the snapshot to be COMPLETE.
 *
 * QuickBooks is only ever read. Nothing here writes to QuickBooks.
 */
import { loadEnvConfig } from '@next/env'

loadEnvConfig(process.cwd())

const command = process.argv[2]
const positional = process.argv[3]
const resourcesArg = process.argv.find((a) => a.startsWith('--resources='))?.slice('--resources='.length)
const strategyArg = process.argv.find((a) => a.startsWith('--strategy='))?.slice('--strategy='.length)
const drive = process.argv.includes('--drive')

async function resolveConnection() {
  const { createAdminClient } = await import('../../src/lib/supabase/admin')
  const db = createAdminClient()
  const provider = await db.from('accounting_integration_providers').select('id').eq('slug', 'quickbooks').single()
  if (provider.error) throw provider.error
  const connection = await db
    .from('accounting_integration_connections')
    .select('tenant_id,connected_by,realm_id')
    .eq('provider_id', provider.data.id)
    .eq('status', 'CONNECTED')
    .order('updated_at', { ascending: false })
    .limit(1)
    .single()
  if (connection.error) throw connection.error
  if (!connection.data.connected_by) throw new Error('Connected QuickBooks account has no connected_by user.')
  return {
    companyId: String(connection.data.tenant_id),
    userId: String(connection.data.connected_by),
    realmId: String(connection.data.realm_id),
  }
}

async function create() {
  const { companyId, userId, realmId } = await resolveConnection()
  const [{ createSnapshot }, { enqueueSnapshotStep }, { getSnapshot }, resources] = await Promise.all([
    import('../../src/lib/import-export/quickbooks/snapshot/snapshot.service'),
    import('../../src/lib/import-export/quickbooks/snapshot/snapshot-orchestrator'),
    import('../../src/lib/import-export/quickbooks/snapshot/snapshot.service'),
    import('../../src/lib/import-export/quickbooks/snapshot/snapshot-resources'),
  ])

  const requestedResources = resourcesArg
    ? resourcesArg.split(',').map((r) => r.trim()).filter(Boolean)
    : resources.allSnapshotResourceKeys()

  const snapshot = await createSnapshot({ companyId, realmId, userId, requestedResources })
  console.log(JSON.stringify({ event: 'snapshot_created', snapshotId: snapshot.id, realmId, storagePrefix: snapshot.storagePrefix }))

  if (!drive) {
    await enqueueSnapshotStep({ snapshotId: snapshot.id, companyId, userId })
    console.log(JSON.stringify({ event: 'snapshot_enqueued', snapshotId: snapshot.id, note: 'run `npm run worker` to process' }))
    return
  }

  const { runSnapshotStep } = await import('../../src/lib/import-export/quickbooks/snapshot/snapshot-step')
  for (let step = 0; step < 5000; step += 1) {
    const outcome = await runSnapshotStep(snapshot.id, companyId, userId)
    console.log(JSON.stringify({ event: 'snapshot_step', step, ...outcome }))
    if (outcome.done) break
  }
  const finalSnapshot = await getSnapshot(snapshot.id, companyId)
  await printReport(snapshot.id, companyId)
  process.exitCode = finalSnapshot?.status === 'COMPLETE' ? 0 : 1
}

async function printStatus(snapshotId: string) {
  const { companyId } = await resolveConnection()
  const { getSnapshot } = await import('../../src/lib/import-export/quickbooks/snapshot/snapshot.service')
  const snapshot = await getSnapshot(snapshotId, companyId)
  if (!snapshot) throw new Error(`Snapshot ${snapshotId} not found.`)
  console.log(
    JSON.stringify(
      {
        snapshotId: snapshot.id,
        status: snapshot.status,
        startedAt: snapshot.startedAt,
        completedAt: snapshot.completedAt,
        entities: snapshot.entities,
        errors: snapshot.errors,
        warnings: snapshot.warnings.slice(0, 20),
        validation: snapshot.validation,
      },
      null,
      2,
    ),
  )
}

async function printReport(snapshotId: string, companyIdArg?: string) {
  const companyId = companyIdArg ?? (await resolveConnection()).companyId
  const [{ getSnapshot }, { buildSnapshotManifest }, { renderSnapshotReport }] = await Promise.all([
    import('../../src/lib/import-export/quickbooks/snapshot/snapshot.service'),
    import('../../src/lib/import-export/quickbooks/snapshot/snapshot-manifest'),
    import('../../src/lib/import-export/quickbooks/snapshot/snapshot-report'),
  ])
  const snapshot = await getSnapshot(snapshotId, companyId)
  if (!snapshot) throw new Error(`Snapshot ${snapshotId} not found.`)
  const manifest = await buildSnapshotManifest(snapshot)
  console.log(renderSnapshotReport(manifest))
}

async function migrate(snapshotId: string) {
  const { companyId, userId } = await resolveConnection()
  const [{ getSnapshot }, { getImportSource }, { orderQuickBooksMigrationResources }, { initializeModuleLifecycle }, { createQuickBooksMigrationSession }] =
    await Promise.all([
      import('../../src/lib/import-export/quickbooks/snapshot/snapshot.service'),
      import('../../src/lib/import-export/sources/source-registry'),
      import('../../src/lib/import-export/quickbooks/dependency-order'),
      import('../../src/lib/import-export/wizard/module-lifecycle'),
      import('../../src/lib/import-export/wizard/migration-session.service'),
    ])

  const snapshot = await getSnapshot(snapshotId, companyId)
  if (!snapshot) throw new Error(`Snapshot ${snapshotId} not found.`)
  if (snapshot.status !== 'COMPLETE') {
    throw new Error(`QuickBooks snapshot is not complete (status ${snapshot.status}). Refusing to migrate.`)
  }

  const completed = new Set(
    Object.values(snapshot.entities)
      .filter((entity) => entity.status === 'completed' && entity.records > 0)
      .map((entity) => entity.resourceKey),
  )
  const source = getImportSource('quickbooks')
  const selectedModules = orderQuickBooksMigrationResources(source.resources.filter((resource) => completed.has(resource.key)))
  if (!selectedModules.length) throw new Error('Snapshot has no completed resources with records to migrate.')

  const duplicateStrategy = (['skip', 'update', 'create'].includes(strategyArg ?? '') ? strategyArg : 'update') as
    | 'skip'
    | 'update'
    | 'create'

  const session = await createQuickBooksMigrationSession({
    userId,
    selectedModules,
    duplicateStrategy,
    lifecycle: initializeModuleLifecycle(selectedModules),
    snapshotId,
    companyIdOverride: companyId,
  })
  console.log(
    JSON.stringify({
      event: 'snapshot_migration_started',
      sessionId: session.id,
      snapshotId,
      modules: selectedModules.map((m) => m.key),
      duplicateStrategy,
      note: 'run `npm run worker` to process; migration reads Storage, not QuickBooks',
    }),
  )
}

async function main() {
  if (command === 'create') return create()
  if (command === 'status') {
    if (!positional) throw new Error('Usage: snapshot.ts status <snapshotId>')
    return printStatus(positional)
  }
  if (command === 'report') {
    if (!positional) throw new Error('Usage: snapshot.ts report <snapshotId>')
    return printReport(positional)
  }
  if (command === 'migrate') {
    if (!positional) throw new Error('Usage: snapshot.ts migrate <snapshotId> [--strategy=update]')
    return migrate(positional)
  }
  throw new Error('Usage: snapshot.ts <create|status|report|migrate> [options]')
}

main().catch((error) => {
  console.error(JSON.stringify({ event: 'snapshot_cli_failed', message: error instanceof Error ? error.message : String(error) }))
  process.exitCode = 1
})
