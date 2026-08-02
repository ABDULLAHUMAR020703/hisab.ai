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
  startAt?: number
  batchSize?: number
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
  const allValidRows = input.rows.filter((row) => input.validation.validRowNumbers.includes(row.rowNumber))
  const validRows = dependencyOrderedRows(input.module.key,allValidRows).slice(input.startAt ?? 0)
  const errors: ImportRowError[] = []
  let importedCount = 0
  let updatedCount = 0
  let skippedCount = 0
  let failedCount = 0
  let paused = false

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

      let createdId: string | undefined
      let recordStage = 'source_check'
      try {
        recordStage='source_hash_check'
        const sourceUnchanged=await isQuickBooksRecordUnchanged(input.ctx.companyId,row.mapped)
        const duplicate = duplicateMap.get(row.rowNumber)
        recordStage='materialization_status_check'
        const priorMaterialization=sourceUnchanged&&duplicate&&tracksQuickBooksMaterialization(input.module.key)?await getQuickBooksMaterializationStatus(input.ctx.companyId,input.module.key,duplicate.existingId,row.mapped):null
        if(sourceUnchanged&&duplicate&&(!tracksQuickBooksMaterialization(input.module.key)||priorMaterialization==='completed')){
          recordStage='source_link_verification'
          await archive(row.mapped, duplicate.existingId)
          await assertQuickBooksRecordLinked(input.ctx.companyId,row.mapped,duplicate.existingId)
          skippedCount+=1
          continue
        }
        recordStage='source_archive'
        await archive(row.mapped)
        recordStage='dependency_validation'
        await assertQuickBooksDependencies(input.module.key, row.mapped, input.ctx)
        // Parsers coerce business fields; protected provider metadata remains
        // authoritative and must accompany the parsed record to materializers.
        const record = { ...row.mapped, ...parser(row.mapped as Record<string, unknown>) }
        const hasDuplicate = Boolean(duplicate)
        const selectedAction = applyDuplicateStrategy(input.duplicateStrategy, hasDuplicate)
        // QuickBooks source identity is canonical. "Create duplicate" is a
        // merge/update for a source record that already exists locally.
        const action = selectedAction === 'create' && typeof row.mapped._realmId === 'string' ? 'update' : selectedAction

        if (action === 'skip') {
          recordStage='source_link_verification'
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
          recordStage='native_update'
          await input.module.updateRecord(duplicate.existingId, record, input.ctx)
          recordStage='source_link_verification'
          await archive(row.mapped, duplicate.existingId)
          await assertQuickBooksRecordLinked(input.ctx.companyId,row.mapped,duplicate.existingId)
          recordStage='accounting_materialization'
          const postingStarted=performance.now()
          try { await materializeQuickBooksAccounting({companyId:input.ctx.companyId,userId:input.ctx.userId,moduleKey:input.module.key,localId:duplicate.existingId,sourceRow:row.mapped});input.trace?.accumulate('posting',performance.now()-postingStarted) }
          catch(error){input.trace?.accumulate('posting',performance.now()-postingStarted,true);throw error}
          recordStage='accounting_verification'
          await assertQuickBooksAccountingCompleted(input.module.key, input.ctx.companyId, duplicate.existingId, row.mapped)
          updatedCount += 1
          continue
        }

        recordStage='native_create'
        const created = await input.module.createRecord(record, input.ctx)
        createdId = created.id
        recordStage='source_link_verification'
        await archive(row.mapped, created.id)
        await assertQuickBooksRecordLinked(input.ctx.companyId,row.mapped,created.id)
        recordStage='accounting_materialization'
        const postingStarted=performance.now()
        try { await materializeQuickBooksAccounting({companyId:input.ctx.companyId,userId:input.ctx.userId,moduleKey:input.module.key,localId:created.id,sourceRow:row.mapped});input.trace?.accumulate('posting',performance.now()-postingStarted) }
        catch(error){input.trace?.accumulate('posting',performance.now()-postingStarted,true);throw error}
        recordStage='accounting_verification'
        await assertQuickBooksAccountingCompleted(input.module.key, input.ctx.companyId, created.id, row.mapped)
        importedCount += 1
      } catch (err) {
        let rollbackMessage: string | undefined
        if (createdId && input.module.rollbackCreatedRecord) {
          try { await input.module.rollbackCreatedRecord(createdId, input.ctx) }
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
  }

  return { importedCount, updatedCount, skippedCount, failedCount, errors, paused }
}
