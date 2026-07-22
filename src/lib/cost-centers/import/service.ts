import 'server-only'
import type { CostCenterRecord } from '@/lib/db/entities'
import { getCostCenterRepository } from '@/lib/db/provider'
import { normalizeCostCenterNameKey, slugifyCostCenterCode } from './constants'
import { extractErrorReason, humanizeImportFailure } from './error-reason'
import { isExcelFooterOrMetadata } from './footer-metadata'
import { buildProductServiceMetadata } from '../product-catalog'
import {
  findExistingProject,
  projectImportMatchKey,
  skuFromProductFields,
  type ProjectImportMode,
} from './project-upsert'
import {
  parseProjectProductServiceSheet,
  parseVerticalListSheet,
  type CostCenterImportKind,
} from './parsers'

export interface CostCenterImportRowError {
  row: number
  value: string
  reason: string
}

export interface CostCenterImportSummary {
  kind: CostCenterImportKind
  /** Newly created records */
  created: number
  /** Existing records updated (projects upsert) */
  updated: number
  /**
   * Backward-compatible total of successful writes.
   * For projects: created + updated. For location/class: same as created.
   */
  imported: number
  skipped: number
  duplicates: number
  failed: number
  errors: CostCenterImportRowError[]
  /** Active import strategy (projects). */
  mode?: ProjectImportMode
}

function prefixForKind(kind: CostCenterImportKind): string {
  if (kind === 'location') return 'LOC'
  if (kind === 'class') return 'CLS'
  return 'PRJ'
}

function typeForKind(kind: CostCenterImportKind): 'LOCATION' | 'CLASS' | 'PROJECT' {
  if (kind === 'location') return 'LOCATION'
  if (kind === 'class') return 'CLASS'
  return 'PROJECT'
}

function duplicateReason(kind: CostCenterImportKind): string {
  if (kind === 'location') return 'Duplicate location name'
  if (kind === 'class') return 'Duplicate class name'
  return 'Duplicate project / product in file'
}

function pushError(
  summary: CostCenterImportSummary,
  row: number,
  value: string,
  reason: string,
) {
  summary.errors.push({
    row,
    value,
    reason: reason.trim() || 'Unknown error',
  })
}

function emptySummary(
  kind: CostCenterImportKind,
  mode?: ProjectImportMode,
): CostCenterImportSummary {
  return {
    kind,
    created: 0,
    updated: 0,
    imported: 0,
    skipped: 0,
    duplicates: 0,
    failed: 0,
    errors: [],
    mode,
  }
}

function bumpCreated(summary: CostCenterImportSummary) {
  summary.created++
  summary.imported = summary.created + summary.updated
}

function bumpUpdated(summary: CostCenterImportSummary) {
  summary.updated++
  summary.imported = summary.created + summary.updated
}

export async function importCostCentersFromBuffer(
  kind: CostCenterImportKind,
  buffer: ArrayBuffer,
  options?: { mode?: ProjectImportMode },
): Promise<CostCenterImportSummary> {
  const repo = getCostCenterRepository()
  const type = typeForKind(kind)
  const mode: ProjectImportMode = options?.mode ?? 'upsert'
  const summary = emptySummary(kind, kind === 'project' ? mode : undefined)

  const seenNames = new Set<string>()

  if (kind === 'location' || kind === 'class') {
    const parsed = parseVerticalListSheet(buffer, kind)
    summary.skipped += parsed.skippedEmpty

    for (const row of parsed.rows) {
      const name = row.name.trim()
      if (!name) {
        summary.skipped++
        continue
      }

      if (isExcelFooterOrMetadata(name)) {
        summary.skipped++
        continue
      }

      if (name.length > 255) {
        summary.failed++
        pushError(summary, row.rowNumber, name, 'Name exceeds 255 characters')
        continue
      }

      const key = normalizeCostCenterNameKey(name)
      if (seenNames.has(key)) {
        summary.duplicates++
        pushError(summary, row.rowNumber, name, duplicateReason(kind))
        continue
      }
      seenNames.add(key)

      try {
        const existing = await repo.findDuplicate({ name, type })
        if (existing && normalizeCostCenterNameKey(existing.name) === key) {
          summary.duplicates++
          pushError(summary, row.rowNumber, name, duplicateReason(kind))
          continue
        }

        await repo.create({
          code: slugifyCostCenterCode(name, prefixForKind(kind)),
          name,
          type,
          description: null,
          isActive: true,
        })
        bumpCreated(summary)
      } catch (error) {
        summary.failed++
        const reason = humanizeImportFailure(kind, extractErrorReason(error))
        pushError(summary, row.rowNumber, name, reason)
      }
    }

    return summary
  }

  // ── Product / Service (PROJECT) upsert sync ──────────────────────────────
  const parsed = parseProjectProductServiceSheet(buffer)
  summary.skipped += parsed.skippedEmpty

  const existingProjects = await repo.findMany({
    type: 'PROJECT',
    includeMetadata: true,
  })
  const working: CostCenterRecord[] = [...existingProjects]

  const seenFileKeys = new Set<string>()

  for (const row of parsed.rows) {
    const name = row.name.trim()
    if (!name) {
      summary.skipped++
      continue
    }

    if (isExcelFooterOrMetadata(name)) {
      summary.skipped++
      continue
    }

    if (name.length > 255) {
      summary.failed++
      pushError(summary, row.rowNumber, name, 'Name exceeds 255 characters')
      continue
    }

    const sku = skuFromProductFields(row.fields)
    const match = projectImportMatchKey({ name, sku })
    if (seenFileKeys.has(match.key)) {
      summary.duplicates++
      pushError(summary, row.rowNumber, name, duplicateReason('project'))
      continue
    }
    seenFileKeys.add(match.key)

    const metadata = buildProductServiceMetadata(row.fields)
    const salesDescription = row.fields['Sales Description']?.trim() || null

    try {
      const existing = findExistingProject(working, { name, sku })

      if (existing) {
        if (mode === 'create_only') {
          summary.duplicates++
          pushError(summary, row.rowNumber, name, 'Project already exists (create-only mode)')
          continue
        }

        // Preserve ID — update master catalog fields (Cost, etc.) in place
        const updated = await repo.update(existing.id, {
          name,
          description: salesDescription,
          isActive: true,
          metadata,
        })

        const idx = working.findIndex((p) => p.id === existing.id)
        if (idx >= 0) working[idx] = updated
        else working.push(updated)

        bumpUpdated(summary)
        continue
      }

      if (mode === 'replace_all') {
        // replace_all without a prior wipe still creates missing rows
      }

      const created = await repo.create({
        code: slugifyCostCenterCode(name, 'PRJ'),
        name,
        type: 'PROJECT',
        description: salesDescription,
        isActive: true,
        metadata,
      })
      working.push(created)
      bumpCreated(summary)
    } catch (error) {
      summary.failed++
      const reason = humanizeImportFailure(kind, extractErrorReason(error))
      pushError(summary, row.rowNumber, name, reason)
    }
  }

  return summary
}
