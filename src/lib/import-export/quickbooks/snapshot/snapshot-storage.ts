import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { snapshotPageFileName } from './snapshot-model'

/**
 * Object I/O for the immutable QuickBooks raw snapshot, in the private
 * `quickbooks-migration` bucket (public = false, 100 MB/file — migration 051/069).
 *
 * All access is service-role and server-only. No signed or public URLs are ever
 * generated for snapshot objects.
 */

export const SNAPSHOT_BUCKET = 'quickbooks-migration'

/** Split a page whose serialized JSON would exceed this into `-part-NN` files. */
export const MAX_PAGE_BYTES = 40 * 1024 * 1024

type StorageClient = ReturnType<typeof createAdminClient>['storage']

function storage(): StorageClient {
  return createAdminClient().storage
}

/** `<companyId>/quickbooks/<realmId>/snapshots/<snapshotId>` — no trailing slash. */
export function snapshotPrefix(companyId: string, realmId: string, snapshotId: string): string {
  return `${companyId}/quickbooks/${realmId}/snapshots/${snapshotId}`
}

export function resourcePrefix(prefix: string, resourceKey: string): string {
  return `${prefix}/${resourceKey}`
}

export function manifestPath(prefix: string): string {
  return `${prefix}/manifest.json`
}

export interface WrittenPageFile {
  file: string // path relative to the snapshot prefix, e.g. `invoices/page-000001.json`
  bytes: number
  records: number
}

interface RawPageBody {
  snapshotId: string
  resourceKey: string
  entity: string
  page: number
  part: number
  partOf: number
  startPosition: number
  partitionStart?: string
  partitionEnd?: string
  recordCount: number
  extractedAt: string
  records: unknown[]
}

/**
 * Writes one extracted provider page as one or more immutable raw JSON objects.
 * Records are never transformed. Returns every object written (for the manifest).
 * Throws on any upload failure so the caller does not advance its checkpoint.
 */
export async function writeRawPage(input: {
  prefix: string
  resourceKey: string
  entity: string
  snapshotId: string
  page: number
  startPosition: number
  partitionStart?: string
  partitionEnd?: string
  records: unknown[]
}): Promise<WrittenPageFile[]> {
  const chunks = splitBySize(input.records, MAX_PAGE_BYTES)
  const written: WrittenPageFile[] = []
  const extractedAt = new Date().toISOString()

  for (let index = 0; index < chunks.length; index += 1) {
    const part = index + 1
    const body: RawPageBody = {
      snapshotId: input.snapshotId,
      resourceKey: input.resourceKey,
      entity: input.entity,
      page: input.page,
      part,
      partOf: chunks.length,
      startPosition: input.startPosition,
      partitionStart: input.partitionStart,
      partitionEnd: input.partitionEnd,
      recordCount: chunks[index].length,
      extractedAt,
      records: chunks[index],
    }
    const serialized = Buffer.from(JSON.stringify(body), 'utf8')
    const relative = `${input.resourceKey}/${snapshotPageFileName(input.page, chunks.length > 1 ? part : undefined)}`
    const { error } = await storage()
      .from(SNAPSHOT_BUCKET)
      .upload(`${input.prefix}/${relative}`, serialized, {
        contentType: 'application/json',
        upsert: true,
        cacheControl: 'no-store',
      })
    if (error) throw new Error(`Snapshot page upload failed for ${relative}: ${error.message}`)
    written.push({ file: relative, bytes: serialized.byteLength, records: chunks[index].length })
  }
  return written
}

export async function readRawPage(prefix: string, relativeFile: string): Promise<unknown[]> {
  const { data, error } = await storage().from(SNAPSHOT_BUCKET).download(`${prefix}/${relativeFile}`)
  if (error || !data) throw new Error(`Snapshot page download failed for ${relativeFile}: ${error?.message ?? 'empty'}`)
  const parsed = JSON.parse(Buffer.from(await data.arrayBuffer()).toString('utf8')) as RawPageBody
  return Array.isArray(parsed.records) ? parsed.records : []
}

export async function writeBinary(prefix: string, relativeFile: string, bytes: Uint8Array, contentType: string): Promise<void> {
  const { error } = await storage()
    .from(SNAPSHOT_BUCKET)
    .upload(`${prefix}/${relativeFile}`, bytes, { contentType, upsert: true, cacheControl: 'no-store' })
  if (error) throw new Error(`Snapshot binary upload failed for ${relativeFile}: ${error.message}`)
}

export async function writeJson(prefix: string, relativeFile: string, value: unknown): Promise<void> {
  const { error } = await storage()
    .from(SNAPSHOT_BUCKET)
    .upload(`${prefix}/${relativeFile}`, Buffer.from(JSON.stringify(value, null, 2), 'utf8'), {
      contentType: 'application/json',
      upsert: true,
      cacheControl: 'no-store',
    })
  if (error) throw new Error(`Snapshot JSON upload failed for ${relativeFile}: ${error.message}`)
}

export async function readJson<T>(prefix: string, relativeFile: string): Promise<T | null> {
  const { data, error } = await storage().from(SNAPSHOT_BUCKET).download(`${prefix}/${relativeFile}`)
  if (error || !data) return null
  return JSON.parse(Buffer.from(await data.arrayBuffer()).toString('utf8')) as T
}

/** One row from a Supabase Storage `list()` call. Folders come back with a null `id`. */
export interface StorageEntry {
  name: string
  id?: string | null
  metadata?: Record<string, unknown> | null
}

/** A paginated directory listing: `(fullPath, offset) => rows`. */
export type ListPageFn = (fullPath: string, offset: number) => Promise<StorageEntry[]>

/** A Storage row is a folder (recurse) when it has no object id and no object metadata. */
export function isStorageFolder(entry: StorageEntry): boolean {
  return (entry.id === null || entry.id === undefined) && entry.metadata == null
}

/**
 * Pure recursive walk of a Storage tree. Returns every *object* path relative to
 * `prefix` (folders themselves are not emitted). An empty or missing folder
 * contributes nothing — it is never mistaken for a file.
 */
export async function collectObjectPaths(prefix: string, listPage: ListPageFn, subPath = ''): Promise<string[]> {
  const full = subPath ? `${prefix}/${subPath}` : prefix
  const out: string[] = []
  for (let offset = 0; ; offset += 100) {
    const rows = await listPage(full, offset)
    if (!rows || rows.length === 0) break
    for (const entry of rows) {
      if (!entry.name || entry.name === '.emptyFolderPlaceholder') continue
      const rel = subPath ? `${subPath}/${entry.name}` : entry.name
      if (isStorageFolder(entry)) {
        out.push(...(await collectObjectPaths(prefix, listPage, rel)))
      } else {
        out.push(rel)
      }
    }
    if (rows.length < 100) break
  }
  return out
}

/** Attempts per directory-page list before giving up (transient Storage 5xx). */
export const SNAPSHOT_LIST_ATTEMPTS = Math.max(1, Number(process.env.QB_SNAPSHOT_LIST_ATTEMPTS ?? 6))

function snapshotListPage(): ListPageFn {
  return async (fullPath, offset) => {
    let lastMessage = 'unknown error'
    for (let attempt = 1; attempt <= SNAPSHOT_LIST_ATTEMPTS; attempt += 1) {
      const { data, error } = await storage()
        .from(SNAPSHOT_BUCKET)
        .list(fullPath, { limit: 100, offset, sortBy: { column: 'name', order: 'asc' } })
      if (!error) return (data ?? []) as StorageEntry[]
      lastMessage = error.message
      if (attempt < SNAPSHOT_LIST_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(400 * attempt, 4_000)))
      }
    }
    // Still a transport error after retries — the caller (finalize) turns this
    // into a step failure that the job queue retries; it never marks a snapshot
    // permanently invalid.
    throw new Error(`Snapshot list failed for ${fullPath} after ${SNAPSHOT_LIST_ATTEMPTS} attempts: ${lastMessage}`)
  }
}

/** Recursively lists every object under `prefix/subPath`, returning paths relative to `prefix`. */
export async function listObjects(prefix: string, subPath = ''): Promise<string[]> {
  return collectObjectPaths(prefix, snapshotListPage(), subPath)
}

export interface StorageObjectStat {
  /** Path relative to `prefix`. */
  path: string
  bytes: number
}

/** Pure recursive walk collecting object path + byte size (folders excluded). */
export async function collectObjectStats(
  prefix: string,
  listPage: ListPageFn,
  subPath = '',
): Promise<StorageObjectStat[]> {
  const full = subPath ? `${prefix}/${subPath}` : prefix
  const out: StorageObjectStat[] = []
  for (let offset = 0; ; offset += 100) {
    const rows = await listPage(full, offset)
    if (!rows || rows.length === 0) break
    for (const entry of rows) {
      if (!entry.name || entry.name === '.emptyFolderPlaceholder') continue
      const rel = subPath ? `${subPath}/${entry.name}` : entry.name
      if (isStorageFolder(entry)) {
        out.push(...(await collectObjectStats(prefix, listPage, rel)))
      } else {
        const size = Number((entry.metadata as Record<string, unknown> | null | undefined)?.size ?? 0)
        out.push({ path: rel, bytes: Number.isFinite(size) ? size : 0 })
      }
    }
    if (rows.length < 100) break
  }
  return out
}

/** Recursively lists every object under `prefix` with its byte size (relative paths). */
export async function listObjectStats(prefix: string, subPath = ''): Promise<StorageObjectStat[]> {
  return collectObjectStats(prefix, snapshotListPage(), subPath)
}

/** Greedy size-bounded chunking: keeps a chunk under `maxBytes` when serialized. */
export function splitBySize(records: unknown[], maxBytes: number): unknown[][] {
  if (records.length <= 1) return [records]
  const whole = Buffer.byteLength(JSON.stringify(records), 'utf8')
  if (whole <= maxBytes) return [records]

  const chunks: unknown[][] = []
  let current: unknown[] = []
  let currentBytes = 2 // for the enclosing brackets
  for (const record of records) {
    const recordBytes = Buffer.byteLength(JSON.stringify(record), 'utf8') + 1
    if (current.length > 0 && currentBytes + recordBytes > maxBytes) {
      chunks.push(current)
      current = []
      currentBytes = 2
    }
    current.push(record)
    currentBytes += recordBytes
  }
  if (current.length) chunks.push(current)
  return chunks
}
