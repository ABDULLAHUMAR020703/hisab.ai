import 'server-only'
import { duplicateMatchesToMap } from '../duplicate/duplicate-detector'
import { applyDuplicateStrategy } from '../duplicate/duplicate-detector'
import type {
  DuplicateMatch,
  DuplicateStrategy,
  ImportContext,
  ImportProcessorResult,
  ImportRowError,
  SkippedRecordDiagnostic,
  MappedRow,
  ModuleDefinition,
  ValidationResult,
} from '../types'
import { archiveQuickBooksRecord, assertQuickBooksRecordLinked, isQuickBooksRecordUnchanged, materializeQuickBooksCustomFields } from '../quickbooks/migration-store'
import { assertQuickBooksDependencies } from '../quickbooks/dependency-check'
import { assertQuickBooksAccountingCompleted, getQuickBooksMaterializationStatus, materializeQuickBooksAccounting, tracksQuickBooksMaterialization } from '../quickbooks/accounting-materializer'
import { normalizeImportError } from './import-error'
import type { MigrationTrace } from '../quickbooks/migration-telemetry'

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
  /** Throws when the worker no longer owns the queue lease. */
  assertActive?: () => Promise<void>
  startAt?: number
  batchSize?: number
  /** Bounds a worker invocation to a single import batch. */
  maxBatches?: number
  trace?: MigrationTrace
}

function dependencyOrderedRows(moduleKey:string,rows:MappedRow[]):MappedRow[]{
  if(moduleKey!=='accounts')return rows
  const pending=[...rows],ordered:MappedRow[]=[],available=new Set<string>()
  while(pending.length){
    const index=pending.findIndex(row=>{const parent=String(row.mapped.parentNo??'').trim();return !parent||available.has(parent)})
    const [next]=pending.splice(index>=0?index:0,1)
    ordered.push(next)
    const accountNo=String(next.mapped.accountNo??'').trim();if(accountNo)available.add(accountNo)
  }
  return ordered
}

export async function processImport(
  input: ProcessImportInput,
): Promise<ImportProcessorResult> {
  const parser = input.module.parseImportRow ?? ((mapped) => mapped)
  const measure = <T>(name: string, operation: () => Promise<T> | T) => input.trace?.measureOperation(name, operation) ?? Promise.resolve(operation())
  const allValidRows = input.rows.filter((row) => input.validation.validRowNumbers.includes(row.rowNumber))
  const validRows = dependencyOrderedRows(input.module.key,allValidRows).slice(input.startAt ?? 0)
  const errors: ImportRowError[] = []
  let importedCount = 0
  let updatedCount = 0
  let skippedCount = 0
  let failedCount = 0
  let paused = false
  const skippedRecords: SkippedRecordDiagnostic[] = []

  const diagnostic = (row: MappedRow, reason: SkippedRecordDiagnostic['reason'], duplicate?: DuplicateMatch): SkippedRecordDiagnostic => {
    const mapped = row.mapped as Record<string, unknown>
    const sourceId = [mapped._quickbooksId, mapped.Id, mapped.id, mapped.docNumber, mapped.accountNo, mapped.sku].find((value) => value !== undefined && value !== null && String(value).trim() !== '')
    const recordName = [mapped.name, mapped.displayName, mapped.customerName, mapped.vendorName, mapped.docNumber].find((value) => value !== undefined && value !== null && String(value).trim() !== '')
    return { rowNumber: row.rowNumber, sourceId: sourceId === undefined ? undefined : String(sourceId), recordName: recordName === undefined ? undefined : String(recordName), reason, duplicateKey: duplicate?.matchedOn?.join(', '), existingRecordId: duplicate?.existingId }
  }

  const duplicateMatches = input.duplicateMatches ?? []
  const duplicateMap = duplicateMatchesToMap(duplicateMatches)

  const archive = async (mapped: Record<string, unknown>, localId?: string) => {
    const realmId = typeof mapped._realmId === 'string' ? mapped._realmId : ''
    const entityType = typeof mapped._quickbooksEntity === 'string' ? mapped._quickbooksEntity : ''
    if (!realmId || !entityType || !mapped._quickbooksRaw) return
    const extendedQuickBooksModule=input.module.key.startsWith('qb-')
    const localTable = extendedQuickBooksModule ? undefined : LOCAL_TABLE_BY_MODULE[input.module.key] ?? input.module.key
    // Extended modules own native linking because their target table is
    // resource-specific. Never overwrite that link with a table-less ID.
    await archiveQuickBooksRecord({ companyId:input.ctx.companyId, realmId, entityType, row:mapped, localTable:localId&&!extendedQuickBooksModule ? localTable : undefined, localId:extendedQuickBooksModule?undefined:localId })
    if (localId && localTable) await materializeQuickBooksCustomFields({ companyId:input.ctx.companyId, entityType:localTable, entityId:localId, row:mapped })
  }

  const batchSize = Math.max(1, input.batchSize ?? DEFAULT_BATCH_SIZE)
  let batchesProcessed = 0
  for (let index = 0; index < validRows.length; index += batchSize) {
    if (input.assertActive) await input.assertActive()
    if (input.isCancelled && (await input.isCancelled())) {
      break
    }
    if (input.isPaused && (await input.isPaused())) { paused = true; break }

    const batch = validRows.slice(index, index + batchSize)

    for (const row of batch) {
      if (input.assertActive) await input.assertActive()
      if (input.isCancelled && (await input.isCancelled())) {
        break
      }
      if (input.isPaused && (await input.isPaused())) { paused = true; break }

      let createdId: string | undefined
      let recordStage = 'source_check'
      try {
        const duplicate = duplicateMap.get(row.rowNumber)
        const selectedAction = applyDuplicateStrategy(input.duplicateStrategy, Boolean(duplicate))
        // QuickBooks source identity is canonical. "Create duplicate" is a
        // merge/update for a source record that already exists locally.
        const action = selectedAction === 'create' && typeof row.mapped._realmId === 'string' ? 'update' : selectedAction
        recordStage='source_hash_check'
        // Replaying an unchanged, fully materialized record is a no-op only when
        // the chosen strategy skips duplicates. An explicit update must always
        // reach updateRecord so the user sees it counted as updated.
        const sourceUnchanged = action === 'skip'
          ? await measure('source_hash_check',()=>isQuickBooksRecordUnchanged(input.ctx.companyId,row.mapped))
          : false
        recordStage='materialization_status_check'
        const priorMaterialization=sourceUnchanged&&duplicate&&tracksQuickBooksMaterialization(input.module.key)?await measure('materialization_status_lookup',()=>getQuickBooksMaterializationStatus(input.ctx.companyId,input.module.key,duplicate.existingId,row.mapped)):null
        if(sourceUnchanged&&duplicate&&(!tracksQuickBooksMaterialization(input.module.key)||priorMaterialization==='completed')){
          recordStage='source_link_verification'
          await measure('source_link_archive',()=>archive(row.mapped, duplicate.existingId))
          await measure('source_link_verification',()=>assertQuickBooksRecordLinked(input.ctx.companyId,row.mapped,duplicate.existingId))
          skippedCount+=1
          skippedRecords.push(diagnostic(row, 'duplicate', duplicate))
          continue
        }
        recordStage='source_archive'
        await measure('source_archive',()=>archive(row.mapped))
        recordStage='dependency_validation'
        await measure('dependency_validation',()=>assertQuickBooksDependencies(input.module.key, row.mapped, input.ctx))
        // Parsers coerce business fields; protected provider metadata remains
        // authoritative and must accompany the parsed record to materializers.
        const record = { ...row.mapped, ...parser(row.mapped as Record<string, unknown>) }

        if (action === 'skip') {
          recordStage='source_link_verification'
          await measure('source_link_archive',()=>archive(row.mapped, duplicate?.existingId))
          skippedCount += 1
          skippedRecords.push(diagnostic(row, 'duplicate', duplicate))
          continue
        }

        if (action === 'update') {
          if (!duplicate) {
            skippedCount += 1
            skippedRecords.push(diagnostic(row, 'other'))
            errors.push({
              rowNumber: row.rowNumber,
              errorCode: 'DUPLICATE_NOT_FOUND',
              message: 'Expected duplicate record for update strategy but none was found',
              rawRow: row.mapped,
            })
            continue
          }
          recordStage='native_update'
          await measure('native_update',()=>input.module.updateRecord(duplicate.existingId, record, input.ctx))
          recordStage='source_link_verification'
          await measure('source_link_archive',()=>archive(row.mapped, duplicate.existingId))
          await measure('source_link_verification',()=>assertQuickBooksRecordLinked(input.ctx.companyId,row.mapped,duplicate.existingId))
          recordStage='accounting_materialization'
          const postingStarted=performance.now()
          try { await measure('accounting_materialization',()=>materializeQuickBooksAccounting({companyId:input.ctx.companyId,userId:input.ctx.userId,moduleKey:input.module.key,localId:duplicate.existingId,sourceRow:row.mapped}));input.trace?.accumulate('posting',performance.now()-postingStarted) }
          catch(error){input.trace?.accumulate('posting',performance.now()-postingStarted,true);throw error}
          recordStage='accounting_verification'
          await measure('accounting_verification',()=>assertQuickBooksAccountingCompleted(input.module.key, input.ctx.companyId, duplicate.existingId, row.mapped))
          updatedCount += 1
          continue
        }

        recordStage='native_create'
        const created = await measure('native_create',()=>input.module.createRecord(record, input.ctx))
        createdId = created.id
        recordStage='source_link_verification'
        await measure('source_link_archive',()=>archive(row.mapped, created.id))
        await measure('source_link_verification',()=>assertQuickBooksRecordLinked(input.ctx.companyId,row.mapped,created.id))
        recordStage='accounting_materialization'
        const postingStarted=performance.now()
        try { await measure('accounting_materialization',()=>materializeQuickBooksAccounting({companyId:input.ctx.companyId,userId:input.ctx.userId,moduleKey:input.module.key,localId:created.id,sourceRow:row.mapped}));input.trace?.accumulate('posting',performance.now()-postingStarted) }
        catch(error){input.trace?.accumulate('posting',performance.now()-postingStarted,true);throw error}
        recordStage='accounting_verification'
        await measure('accounting_verification',()=>assertQuickBooksAccountingCompleted(input.module.key, input.ctx.companyId, created.id, row.mapped))
        importedCount += 1
      } catch (err) {
        let rollbackMessage: string | undefined
        if (createdId && input.module.rollbackCreatedRecord) {
          try { await measure('rollback_created_record',()=>input.module.rollbackCreatedRecord!(createdId!, input.ctx)) }
          catch (rollbackError) { rollbackMessage = normalizeImportError(rollbackError).message }
        }
        const normalized = normalizeImportError(err)
        failedCount += 1
        errors.push({
          rowNumber: row.rowNumber,
          errorCode: normalized.errorCode,
          message: rollbackMessage ? `${recordStage}: ${normalized.message} Cleanup also failed: ${rollbackMessage}` : `${recordStage}: ${normalized.message}`,
          details: { ...normalized.details, stage:recordStage },
          rawRow: { ...row.mapped, _importError: { ...normalized.details, stage:recordStage } },
        })
      }
    }

    if (input.onProgress) {
      await input.onProgress(Math.min((input.startAt ?? 0) + index + batch.length, allValidRows.length), allValidRows.length, { importedCount, updatedCount, skippedCount, failedCount })
    }
    batchesProcessed += 1
    if (input.maxBatches && batchesProcessed >= input.maxBatches) break
  }

  return { importedCount, updatedCount, skippedCount, failedCount, errors, skippedRecords, paused }
}
