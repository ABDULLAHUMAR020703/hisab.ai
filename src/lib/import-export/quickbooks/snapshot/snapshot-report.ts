import type { SnapshotEntitySummary, SnapshotManifest } from './snapshot-model'
import { getSnapshotResourceSpec, SNAPSHOT_RESOURCES } from './snapshot-resources'

/**
 * Pure manifest -> human-readable report. Three explicitly separated sections:
 * COMPLETE / extracted, UNSUPPORTED / unavailable (with provider reason), FAILED.
 * An unsupported or failed resource is never listed as complete.
 */
export function renderSnapshotReport(manifest: SnapshotManifest): string {
  const lines: string[] = []
  const label = (key: string) => getSnapshotResourceSpec(key)?.label ?? key

  lines.push('QuickBooks Snapshot')
  lines.push('-------------------')
  lines.push(`Snapshot ID: ${manifest.snapshotId}`)
  lines.push(`Realm ID:    ${manifest.realmId}`)
  lines.push(`Company:     ${String(manifest.sourceCompany?.companyName ?? manifest.companyId)}`)
  lines.push(`Status:      ${manifest.status}`)
  lines.push(`Extractor:   ${manifest.extractorVersion}`)
  lines.push(`Started:     ${manifest.startedAt}`)
  lines.push(`Finished:    ${manifest.completedAt ?? '(running)'}`)
  lines.push('')

  const entries = Object.values(manifest.entities)
  const complete = entries.filter((e) => e.status === 'completed').sort(byKey)
  const unsupported = entries.filter((e) => e.status === 'unsupported').sort(byKey)
  const failed = entries.filter((e) => e.status === 'failed').sort(byKey)
  const pending = entries.filter((e) => e.status === 'pending' || e.status === 'running').sort(byKey)

  lines.push('COMPLETE / extracted')
  lines.push(pad('Resource', 24) + pad('Pages', 8) + pad('Records', 12) + 'Mode')
  for (const entity of complete) {
    lines.push(
      pad(label(entity.resourceKey), 24) +
        pad(String(entity.pages), 8) +
        pad(String(entity.records), 12) +
        entity.extractionMode,
    )
  }
  if (!complete.length) lines.push('  (none)')
  lines.push('')

  lines.push('UNSUPPORTED / unavailable from this QuickBooks company/edition')
  for (const entity of unsupported) {
    const status = entity.unsupportedStatus ? ` [HTTP ${entity.unsupportedStatus}]` : ''
    lines.push(`  ${label(entity.resourceKey)}${status} — ${entity.unsupportedReason ?? 'no reason reported'}`)
  }
  if (!unsupported.length) lines.push('  (none)')
  lines.push('')

  lines.push('FAILED')
  for (const entity of failed) {
    lines.push(`  ${label(entity.resourceKey)} — ${entity.error ?? 'unknown error'}`)
  }
  if (!failed.length) lines.push('  (none)')
  lines.push('')

  // Attachments: metadata capture is reported separately from binary downloads,
  // so a COMPLETE snapshot never hides missing attachment files.
  const attachments = manifest.entities['attachments']
  if (attachments && manifest.requestedResources.includes('attachments')) {
    const s = attachments.attachmentSummary
    lines.push('ATTACHMENTS')
    lines.push(`  Metadata (Attachable) records: ${attachments.records}  [${attachments.status}]`)
    if (s) {
      lines.push(`  Binary files downloaded:      ${s.binariesDownloaded}`)
      lines.push(`  Binary files FAILED:          ${s.binariesFailed}${s.binariesFailed ? '  (per-file detail in attachments/index.json; each is listed under Warnings)' : ''}`)
      if (s.binariesFailed > 0) {
        lines.push('  NOTE: attachment metadata is captured but some binary files were not downloaded.')
      }
    } else {
      lines.push('  Binary download: not run / no summary recorded.')
    }
    lines.push('')
  }

  if (pending.length) {
    lines.push('NOT YET TERMINAL')
    for (const entity of pending) lines.push(`  ${label(entity.resourceKey)} — ${entity.status}`)
    lines.push('')
  }

  const requestedButMissing = manifest.requestedResources.filter((key) => !manifest.entities[key])
  if (requestedButMissing.length) {
    lines.push('REQUESTED BUT NOT STARTED')
    for (const key of requestedButMissing) lines.push(`  ${label(key)}`)
    lines.push('')
  }

  const knownKeys = new Set(SNAPSHOT_RESOURCES.map((s) => s.resourceKey))
  const notRequested = [...knownKeys].filter((key) => !manifest.requestedResources.includes(key))
  if (notRequested.length) {
    lines.push(`NOT REQUESTED (${notRequested.length}): ${notRequested.join(', ')}`)
    lines.push('')
  }

  if (manifest.warnings.length) {
    lines.push(`Warnings (${manifest.warnings.length}):`)
    for (const warning of manifest.warnings.slice(0, 20)) lines.push(`  - ${warning}`)
    lines.push('')
  }

  if (manifest.validation) {
    lines.push(`Validation: ${manifest.validation.ok ? 'PASS' : 'FAIL'}`)
    for (const issue of manifest.validation.issues) lines.push(`  - [${issue.code}] ${issue.message}`)
    lines.push('')
  }

  lines.push('Storage:')
  lines.push(`  ${manifest.storageBucket}/${manifest.storagePrefix}`)

  return lines.join('\n')
}

function byKey(a: SnapshotEntitySummary, b: SnapshotEntitySummary): number {
  return a.resourceKey.localeCompare(b.resourceKey)
}

function pad(value: string, width: number): string {
  return value.length >= width ? `${value} ` : value + ' '.repeat(width - value.length)
}
