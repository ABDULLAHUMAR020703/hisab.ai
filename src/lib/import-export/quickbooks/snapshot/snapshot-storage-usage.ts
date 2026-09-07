import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { isStorageFolder, type StorageEntry } from './snapshot-storage'

/**
 * Project-wide Supabase Storage usage measurement.
 *
 * The Free plan's 1 GB File Storage quota is shared across EVERY bucket in the
 * project, not just `quickbooks-migration`. The attachment budget therefore has
 * to be based on total measured usage across all buckets (`company-files`
 * included), because that other data can grow independently.
 *
 * `storage.objects` is not reachable over PostgREST (the `storage` schema is not
 * exposed), so usage is derived from a paginated recursive `list()` walk.
 */

/** Buckets known to draw on the shared project quota (fallback when listBuckets fails). */
export const QUOTA_BUCKETS = ['quickbooks-migration', 'company-files'] as const

const LIST_PAGE = 100

export interface StorageUsageProbe {
  buckets: readonly string[]
  /** One directory page in a bucket. `path` '' means the bucket root. */
  listPage: (bucket: string, path: string, offset: number) => Promise<StorageEntry[]>
}

export interface StorageUsage {
  totalBytes: number
  totalObjects: number
  byBucket: Record<string, { bytes: number; objects: number }>
}

/** Pure: recursively sums object bytes across the probe's buckets. */
export async function measureStorageUsageBytes(probe: StorageUsageProbe): Promise<StorageUsage> {
  const byBucket: Record<string, { bytes: number; objects: number }> = {}
  let totalBytes = 0
  let totalObjects = 0

  for (const bucket of probe.buckets) {
    const walk = async (path: string): Promise<{ bytes: number; objects: number }> => {
      let bytes = 0
      let objects = 0
      for (let offset = 0; ; offset += LIST_PAGE) {
        const rows = await probe.listPage(bucket, path, offset)
        if (!rows || rows.length === 0) break
        for (const entry of rows) {
          if (!entry.name || entry.name === '.emptyFolderPlaceholder') continue
          const child = path ? `${path}/${entry.name}` : entry.name
          if (isStorageFolder(entry)) {
            const sub = await walk(child)
            bytes += sub.bytes
            objects += sub.objects
          } else {
            const size = Number((entry.metadata as Record<string, unknown> | null | undefined)?.size ?? 0)
            bytes += Number.isFinite(size) ? size : 0
            objects += 1
          }
        }
        if (rows.length < LIST_PAGE) break
      }
      return { bytes, objects }
    }

    const result = await walk('')
    byBucket[bucket] = result
    totalBytes += result.bytes
    totalObjects += result.objects
  }

  return { totalBytes, totalObjects, byBucket }
}

/** Real probe: every bucket in the project, retrying transient Storage 5xx. */
export async function measureProjectStorageUsage(): Promise<StorageUsage> {
  const storage = createAdminClient().storage
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

  const listPage = async (bucket: string, path: string, offset: number): Promise<StorageEntry[]> => {
    for (let attempt = 1; ; attempt += 1) {
      const { data, error } = await storage
        .from(bucket)
        .list(path, { limit: LIST_PAGE, offset, sortBy: { column: 'name', order: 'asc' } })
      if (!error) return (data ?? []) as StorageEntry[]
      if (attempt >= 6) {
        throw new Error(`storage usage probe failed for ${bucket}/${path || '(root)'}@${offset}: ${error.message}`)
      }
      await sleep(400 * attempt)
    }
  }

  let buckets: string[] = [...QUOTA_BUCKETS]
  try {
    const { data } = await storage.listBuckets()
    if (data && data.length) buckets = data.map((b) => b.id)
  } catch {
    // keep the fallback list
  }

  return measureStorageUsageBytes({ buckets, listPage })
}
