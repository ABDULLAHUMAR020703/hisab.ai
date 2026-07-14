import 'server-only'
import { duplicateMatchesToMap } from '../duplicate/duplicate-detector'
import { applyDuplicateStrategy } from '../duplicate/duplicate-detector'
import type {
  DuplicateMatch,
  DuplicateStrategy,
  ImportContext,
  ImportProcessorResult,
  ImportRowError,
  MappedRow,
  ModuleDefinition,
  ValidationResult,
} from '../types'

const BATCH_SIZE = 100

export interface ProcessImportInput {
  module: ModuleDefinition
  rows: MappedRow[]
  validation: ValidationResult
  duplicateStrategy: DuplicateStrategy
  duplicateMatches?: DuplicateMatch[]
  ctx: ImportContext
  onProgress?: (processed: number, total: number) => Promise<void>
  isCancelled?: () => Promise<boolean>
}

export async function processImport(
  input: ProcessImportInput,
): Promise<ImportProcessorResult> {
  const parser = input.module.parseImportRow ?? ((mapped) => mapped)
  const validRows = input.rows.filter((row) => input.validation.validRowNumbers.includes(row.rowNumber))
  const errors: ImportRowError[] = []
  let importedCount = 0
  let updatedCount = 0
  let skippedCount = 0
  let failedCount = 0

  const duplicateMatches = input.duplicateMatches ?? []
  const duplicateMap = duplicateMatchesToMap(duplicateMatches)

  for (let index = 0; index < validRows.length; index += BATCH_SIZE) {
    if (input.isCancelled && (await input.isCancelled())) {
      break
    }

    const batch = validRows.slice(index, index + BATCH_SIZE)

    for (const row of batch) {
      if (input.isCancelled && (await input.isCancelled())) {
        break
      }

      try {
        const record = parser(row.mapped as Record<string, unknown>)
        const duplicate = duplicateMap.get(row.rowNumber)
        const hasDuplicate = Boolean(duplicate)
        const action = applyDuplicateStrategy(input.duplicateStrategy, hasDuplicate)

        if (action === 'skip') {
          skippedCount += 1
          continue
        }

        if (action === 'update') {
          if (!duplicate) {
            skippedCount += 1
            errors.push({
              rowNumber: row.rowNumber,
              errorCode: 'DUPLICATE_NOT_FOUND',
              message: 'Expected duplicate record for update strategy but none was found',
              rawRow: row.mapped,
            })
            continue
          }
          await input.module.updateRecord(duplicate.existingId, record, input.ctx)
          updatedCount += 1
          continue
        }

        await input.module.createRecord(record, input.ctx)
        importedCount += 1
      } catch (err) {
        failedCount += 1
        errors.push({
          rowNumber: row.rowNumber,
          errorCode: 'IMPORT_FAILED',
          message: err instanceof Error ? err.message : 'Import failed',
          rawRow: row.mapped,
        })
      }
    }

    if (input.onProgress) {
      await input.onProgress(Math.min(index + batch.length, validRows.length), validRows.length)
    }
  }

  return { importedCount, updatedCount, skippedCount, failedCount, errors }
}
