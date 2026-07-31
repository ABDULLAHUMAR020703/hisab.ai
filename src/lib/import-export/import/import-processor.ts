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
import { archiveQuickBooksRecord, materializeQuickBooksCustomFields } from '../quickbooks/migration-store'

const DEFAULT_BATCH_SIZE = 100
const LOCAL_TABLE_BY_MODULE: Record<string,string> = {
  accounts:'chart_of_accounts', customers:'customers', vendors:'vendors', inventory:'inventory_items', 'cost-centers':'cost_centers', employees:'employees', 'tax-rates':'tax_rates', 'payment-terms':'payment_terms',
  invoices:'invoices', bills:'bills', expenses:'expenses', 'journal-entries':'journal_entries', 'sales-receipts':'sales_receipts', 'purchase-orders':'purchase_orders', 'vendor-credits':'vendor_credits', estimates:'estimates', 'customer-payments':'payments', 'vendor-payments':'payments',
}

export interface ProcessImportInput {
  module: ModuleDefinition
  rows: MappedRow[]
  validation: ValidationResult
  duplicateStrategy: DuplicateStrategy
  duplicateMatches?: DuplicateMatch[]
  ctx: ImportContext
  onProgress?: (processed: number, total: number, counts?: Pick<ImportProcessorResult, 'importedCount' | 'updatedCount' | 'skippedCount' | 'failedCount'>) => Promise<void>
  isCancelled?: () => Promise<boolean>
  isPaused?: () => Promise<boolean>
  startAt?: number
  batchSize?: number
}

export async function processImport(
  input: ProcessImportInput,
): Promise<ImportProcessorResult> {
  const parser = input.module.parseImportRow ?? ((mapped) => mapped)
  const allValidRows = input.rows.filter((row) => input.validation.validRowNumbers.includes(row.rowNumber))
  const validRows = allValidRows.slice(input.startAt ?? 0)
  const errors: ImportRowError[] = []
  let importedCount = 0
  let updatedCount = 0
  let skippedCount = 0
  let failedCount = 0
  let paused = false

  const duplicateMatches = input.duplicateMatches ?? []
  const duplicateMap = duplicateMatchesToMap(duplicateMatches)

  const archive = async (mapped: Record<string, unknown>, localId?: string) => {
    if (input.module.key.startsWith('qb-')) return
    const realmId = typeof mapped._realmId === 'string' ? mapped._realmId : ''
    const entityType = typeof mapped._quickbooksEntity === 'string' ? mapped._quickbooksEntity : ''
    if (!realmId || !entityType || !mapped._quickbooksRaw) return
    const localTable = LOCAL_TABLE_BY_MODULE[input.module.key] ?? input.module.key
    await archiveQuickBooksRecord({ companyId:input.ctx.companyId, realmId, entityType, row:mapped, localTable, localId })
    if (localId) await materializeQuickBooksCustomFields({ companyId:input.ctx.companyId, entityType:localTable, entityId:localId, row:mapped })
  }

  const batchSize = Math.max(1, input.batchSize ?? DEFAULT_BATCH_SIZE)
  for (let index = 0; index < validRows.length; index += batchSize) {
    if (input.isCancelled && (await input.isCancelled())) {
      break
    }
    if (input.isPaused && (await input.isPaused())) { paused = true; break }

    const batch = validRows.slice(index, index + batchSize)

    for (const row of batch) {
      if (input.isCancelled && (await input.isCancelled())) {
        break
      }
      if (input.isPaused && (await input.isPaused())) { paused = true; break }

      try {
        const record = parser(row.mapped as Record<string, unknown>)
        const duplicate = duplicateMap.get(row.rowNumber)
        const hasDuplicate = Boolean(duplicate)
        const action = applyDuplicateStrategy(input.duplicateStrategy, hasDuplicate)

        if (action === 'skip') {
          await archive(row.mapped, duplicate?.existingId)
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
          await archive(row.mapped, duplicate.existingId)
          updatedCount += 1
          continue
        }

        const created = await input.module.createRecord(record, input.ctx)
        await archive(row.mapped, created.id)
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
      await input.onProgress(Math.min((input.startAt ?? 0) + index + batch.length, allValidRows.length), allValidRows.length, { importedCount, updatedCount, skippedCount, failedCount })
    }
  }

  return { importedCount, updatedCount, skippedCount, failedCount, errors, paused }
}
