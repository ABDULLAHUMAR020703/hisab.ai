import 'server-only'
import { getCostCenterRepository } from '@/lib/db/provider'
import { normalizeCostCenterNameKey, slugifyCostCenterCode } from './constants'
import { extractErrorReason, humanizeImportFailure } from './error-reason'
import { isExcelFooterOrMetadata } from './footer-metadata'
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
  imported: number
  skipped: number
  duplicates: number
  failed: number
  errors: CostCenterImportRowError[]
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
  return 'Duplicate project / product name'
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

export async function importCostCentersFromBuffer(
  kind: CostCenterImportKind,
  buffer: ArrayBuffer,
): Promise<CostCenterImportSummary> {
  const repo = getCostCenterRepository()
  const type = typeForKind(kind)
  const summary: CostCenterImportSummary = {
    kind,
    imported: 0,
    skipped: 0,
    duplicates: 0,
    failed: 0,
    errors: [],
  }

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

      // Defense in depth: never persist Excel print/footer metadata as a Cost Center
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
        // Duplicate only when the entire name already exists (never parent/prefix path)
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
        summary.imported++
      } catch (error) {
        summary.failed++
        const reason = humanizeImportFailure(kind, extractErrorReason(error))
        pushError(summary, row.rowNumber, name, reason)
      }
    }

    return summary
  }

  const parsed = parseProjectProductServiceSheet(buffer)
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
      const existing = await repo.findDuplicate({ name, type: 'PROJECT' })
      if (existing && normalizeCostCenterNameKey(existing.name) === key) {
        summary.duplicates++
        pushError(summary, row.rowNumber, name, duplicateReason(kind))
        continue
      }

      const salesDescription = row.fields['Sales Description']?.trim() || null
      await repo.create({
        code: slugifyCostCenterCode(name, 'PRJ'),
        name,
        type: 'PROJECT',
        description: salesDescription,
        isActive: true,
        metadata: row.fields,
      })
      summary.imported++
    } catch (error) {
      summary.failed++
      const reason = humanizeImportFailure(kind, extractErrorReason(error))
      pushError(summary, row.rowNumber, name, reason)
    }
  }

  return summary
}
