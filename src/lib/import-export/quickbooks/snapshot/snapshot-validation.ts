import {
  parseSnapshotPageFileName,
  type SnapshotAttachmentLedgerEntry,
  type SnapshotEntityStatus,
  type SnapshotManifest,
  type SnapshotValidationIssue,
  type SnapshotValidationReport,
} from './snapshot-model'
import { getSnapshotResourceSpec } from './snapshot-resources'

/**
 * Pure snapshot validator.
 *
 * Structural checks run from the manifest alone. When `readPage` is supplied,
 * deep checks additionally parse every page and verify duplicate QuickBooks
 * `Id`s across the WHOLE resource — every page and, for date-partitioned
 * transaction resources, every partition.
 */
export interface SnapshotValidationOptions {
  /** Loads the raw records of one page file (relative to the snapshot prefix). */
  readPage?: (relativeFile: string) => Promise<unknown[]>
  now?: () => Date
  /** Per-attachment capture ledger — verified against Storage when supplied. */
  attachmentLedger?: SnapshotAttachmentLedgerEntry[]
  /**
   * Every object path (relative to the snapshot prefix) -> byte size, from the
   * finalize Storage walk. When supplied, manifest file references and captured
   * attachment objects are verified to exist with the recorded size.
   */
  storageObjectBytes?: Map<string, number>
}

const RAW_ID_ENTITIES_WITHOUT_ID = new Set(['Preferences'])

export async function validateSnapshot(
  manifest: SnapshotManifest,
  options: SnapshotValidationOptions = {},
): Promise<SnapshotValidationReport> {
  const issues: SnapshotValidationIssue[] = []
  const resourceStatuses: Record<string, SnapshotEntityStatus> = {}
  const now = options.now ?? (() => new Date())

  for (const resourceKey of manifest.requestedResources) {
    const summary = manifest.entities[resourceKey]
    const spec = getSnapshotResourceSpec(resourceKey)
    const isRequired = manifest.requiredResources.includes(resourceKey)

    if (!summary) {
      resourceStatuses[resourceKey] = 'pending'
      issues.push({ resourceKey, code: 'not_terminal', message: `${resourceKey} has no extraction status.` })
      continue
    }
    resourceStatuses[resourceKey] = summary.status

    if (summary.status === 'pending' || summary.status === 'running') {
      issues.push({ resourceKey, code: 'not_terminal', message: `${resourceKey} extraction is not finished (${summary.status}).` })
      continue
    }

    if (summary.status === 'failed') {
      if (isRequired) {
        issues.push({ resourceKey, code: 'required_failed', message: `Required resource ${resourceKey} failed: ${summary.error ?? 'unknown error'}` })
      }
      continue
    }

    if (summary.status === 'unsupported') {
      if (isRequired) {
        issues.push({
          resourceKey,
          code: 'required_unsupported',
          message: `Required resource ${resourceKey} is unsupported by this QuickBooks company/edition (${summary.unsupportedStatus ?? '?'}): ${summary.unsupportedReason ?? ''}`,
        })
      }
      continue
    }

    // status === 'completed'
    const pageFiles = summary.files
      .map((file) => ({ file, parsed: parseSnapshotPageFileName(file.split('/').slice(1).join('/')) }))
      .filter((entry) => entry.parsed) as Array<{ file: string; parsed: { page: number; part: number } }>

    // Every manifest page reference must resolve to a real Storage object.
    if (options.storageObjectBytes) {
      for (const entry of pageFiles) {
        if (!options.storageObjectBytes.has(entry.file)) {
          issues.push({
            resourceKey,
            code: 'missing_file',
            message: `${resourceKey} manifest references ${entry.file} but no Storage object exists there.`,
          })
        }
      }
    }

    // Page numbering must be contiguous from 1.
    const pageNumbers = [...new Set(pageFiles.map((entry) => entry.parsed.page))].sort((a, b) => a - b)
    for (let index = 0; index < pageNumbers.length; index += 1) {
      if (pageNumbers[index] !== index + 1) {
        issues.push({ resourceKey, code: 'page_gap', message: `${resourceKey} page numbering has a gap near page ${index + 1}.` })
        break
      }
    }
    if (summary.pages > 0 && pageNumbers.length !== summary.pages) {
      // parts can inflate file count but not distinct page numbers
      if (pageNumbers.length < summary.pages) {
        issues.push({
          resourceKey,
          code: 'missing_file',
          message: `${resourceKey} manifest reports ${summary.pages} pages but only ${pageNumbers.length} page files exist.`,
        })
      }
    }

    // Partition boundary continuity for date-partitioned transaction resources.
    if (spec?.mode === 'query-partitioned' && summary.partitions && summary.partitions.length > 1) {
      const windows = [...summary.partitions].sort((a, b) => a.start.localeCompare(b.start))
      for (let index = 1; index < windows.length; index += 1) {
        const prevEnd = windows[index - 1].end.slice(0, 10)
        const currStart = windows[index].start.slice(0, 10)
        if (currStart < prevEnd) {
          issues.push({ resourceKey, code: 'partition_overlap', message: `${resourceKey} partition windows overlap at ${currStart}.` })
        } else if (currStart > prevEnd) {
          issues.push({ resourceKey, code: 'partition_gap', message: `${resourceKey} partition windows have a gap between ${prevEnd} and ${currStart}.` })
        }
      }
    }

    // Deep checks: JSON validity + whole-resource duplicate IDs.
    if (options.readPage && summary.entity && !RAW_ID_ENTITIES_WITHOUT_ID.has(summary.entity)) {
      const seenIds = new Set<string>()
      let deepRecordCount = 0
      for (const entry of pageFiles) {
        let records: unknown[]
        try {
          records = await options.readPage(entry.file)
        } catch (error) {
          issues.push({ resourceKey, code: 'invalid_json', message: `${entry.file}: ${error instanceof Error ? error.message : String(error)}` })
          continue
        }
        deepRecordCount += records.length
        for (const record of records) {
          const id = record && typeof record === 'object' ? String((record as Record<string, unknown>).Id ?? '') : ''
          if (!id) continue
          if (seenIds.has(id)) {
            issues.push({ resourceKey, code: 'duplicate_id', message: `${resourceKey} contains QuickBooks Id ${id} more than once across the snapshot.` })
          }
          seenIds.add(id)
        }
      }
      if (summary.records > 0 && deepRecordCount !== summary.records) {
        issues.push({
          resourceKey,
          code: 'count_mismatch',
          message: `${resourceKey} manifest reports ${summary.records} records but page files contain ${deepRecordCount}.`,
        })
      }
    }
  }

  // Attachment ledger integrity. Attachments are optional, so SKIPPED_BUDGET /
  // FAILED / UNAVAILABLE entries never block COMPLETE — but a ledger that
  // claims CAPTURED must have a real, correctly-sized Storage object, because
  // snapshot-backed migration points a `documents.file_path` straight at it.
  if (options.attachmentLedger && manifest.requestedResources.includes('attachments')) {
    const seen = new Set<string>()
    let capturedCount = 0
    for (const entry of options.attachmentLedger) {
      if (seen.has(entry.attachableId)) {
        issues.push({
          resourceKey: 'attachments',
          code: 'attachment_ledger_inconsistent',
          message: `duplicate ledger entry for attachable ${entry.attachableId}`,
        })
        continue
      }
      seen.add(entry.attachableId)

      if (entry.status === 'captured') {
        capturedCount += 1
        if (!entry.storagePath) {
          issues.push({
            resourceKey: 'attachments',
            code: 'attachment_ledger_inconsistent',
            message: `captured attachment ${entry.attachableId} has no storage path`,
          })
          continue
        }
        if (options.storageObjectBytes) {
          const actual = options.storageObjectBytes.get(entry.storagePath)
          if (actual === undefined) {
            issues.push({
              resourceKey: 'attachments',
              code: 'attachment_missing_object',
              message: `captured attachment ${entry.attachableId} has no Storage object at ${entry.storagePath}`,
            })
          } else if (entry.capturedBytes != null && actual !== entry.capturedBytes) {
            issues.push({
              resourceKey: 'attachments',
              code: 'attachment_size_mismatch',
              message: `attachment ${entry.attachableId}: ledger ${entry.capturedBytes} B vs Storage ${actual} B`,
            })
          }
        }
      } else if (entry.storagePath) {
        issues.push({
          resourceKey: 'attachments',
          code: 'attachment_ledger_inconsistent',
          message: `${entry.status} attachment ${entry.attachableId} still references Storage path ${entry.storagePath}`,
        })
      }
    }

    // The attachment summary count must reconcile with the ledger.
    const summaryCaptured = manifest.entities['attachments']?.attachmentSummary?.captured
    if (summaryCaptured != null && summaryCaptured !== capturedCount) {
      issues.push({
        resourceKey: 'attachments',
        code: 'attachment_ledger_inconsistent',
        message: `attachment summary reports ${summaryCaptured} captured but the ledger has ${capturedCount}`,
      })
    }
  }

  return {
    ok: issues.length === 0,
    checkedAt: now().toISOString(),
    issues,
    resourceStatuses,
  }
}
