import 'server-only'
import {
  parseSnapshotPageFileName,
  type SnapshotEntitySummary,
  type SnapshotManifest,
} from './snapshot-model'
import { requiredSnapshotResourceKeys } from './snapshot-resources'
import { listCheckpoints, type SnapshotRow } from './snapshot.service'
import { listObjects, manifestPath, readJson, writeJson } from './snapshot-storage'

/**
 * Builds the manifest from the DB snapshot row + checkpoints + the actual objects
 * present in Storage. The manifest is the snapshot's portable source of truth:
 * migration reads it to enumerate pages without touching QuickBooks.
 */
export async function buildSnapshotManifest(snapshot: SnapshotRow): Promise<SnapshotManifest> {
  const checkpoints = await listCheckpoints(snapshot.id)
  const objectPaths = await listObjects(snapshot.storagePrefix)

  const filesByResource = new Map<string, string[]>()
  for (const path of objectPaths) {
    const [resourceKey] = path.split('/')
    if (!resourceKey || path === 'manifest.json') continue
    const list = filesByResource.get(resourceKey) ?? []
    list.push(path)
    filesByResource.set(resourceKey, list)
  }

  const entities: Record<string, SnapshotEntitySummary> = {}
  for (const checkpoint of checkpoints) {
    const files = (filesByResource.get(checkpoint.resourceKey) ?? [])
      .filter((f) => parseSnapshotPageFileName(f.split('/').slice(1).join('/')) || f.endsWith('.json'))
      .sort()
    entities[checkpoint.resourceKey] = {
      resourceKey: checkpoint.resourceKey,
      entity: checkpoint.entity,
      status: checkpoint.status,
      extractionMode: checkpoint.extractionMode,
      pages: checkpoint.pagesWritten,
      records: checkpoint.recordsWritten,
      files,
      partitions: checkpoint.partitions.length ? checkpoint.partitions : undefined,
      error: checkpoint.lastError ?? undefined,
      unsupportedReason: checkpoint.unsupportedReason ?? undefined,
      unsupportedStatus: checkpoint.unsupportedStatus ?? undefined,
      attachmentSummary: checkpoint.attachmentSummary ?? undefined,
    }
  }

  return {
    snapshotId: snapshot.id,
    companyId: snapshot.companyId,
    realmId: snapshot.realmId,
    status: snapshot.status,
    storageBucket: snapshot.storageBucket,
    storagePrefix: snapshot.storagePrefix,
    extractorVersion: snapshot.extractorVersion,
    startedAt: snapshot.startedAt,
    completedAt: snapshot.completedAt,
    sourceCompany: snapshot.sourceCompany,
    requiredResources: requiredSnapshotResourceKeys(snapshot.requestedResources),
    requestedResources: snapshot.requestedResources,
    entities,
    errors: snapshot.errors,
    warnings: snapshot.warnings,
    validation: snapshot.validation ?? undefined,
  }
}

export async function writeSnapshotManifest(snapshot: SnapshotRow): Promise<SnapshotManifest> {
  const manifest = await buildSnapshotManifest(snapshot)
  await writeJson(snapshot.storagePrefix, 'manifest.json', manifest)
  return manifest
}

export async function readSnapshotManifest(storagePrefix: string): Promise<SnapshotManifest | null> {
  return readJson<SnapshotManifest>(storagePrefix, 'manifest.json').catch(() => null)
}

export { manifestPath }
