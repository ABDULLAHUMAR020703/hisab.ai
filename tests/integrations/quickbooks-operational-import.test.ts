import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import { applyColumnMapping } from '../../src/lib/import-export/mapping/auto-mapper'
import { normalizeImportError, MissingDependencyError } from '../../src/lib/import-export/import/import-error'
import { orderQuickBooksMigrationResources } from '../../src/lib/import-export/quickbooks/dependency-order'
import { QuickBooksImportAdapter, stableQuickBooksSourceId } from '../../src/lib/import-export/sources/quickbooks.adapter'

const file=(path:string)=>readFileSync(resolve(process.cwd(),path),'utf8')

test('auto mapping preserves all protected QuickBooks metadata',()=>{
  const raw={Id:'42',SyncToken:'7',LinkedTxn:[{TxnId:'9',TxnType:'Invoice'}],CustomField:[{DefinitionId:'1',StringValue:'x'}]}
  const source={name:'Acme',_realmId:'realm',_quickbooksId:'42',_quickbooksEntity:'Customer',_quickbooksRaw:JSON.stringify(raw),_quickbooksMeta:'{}',_quickbooksSyncToken:'7',_quickbooksRelationships:JSON.stringify(raw.LinkedTxn),_quickbooksCustomFields:JSON.stringify(raw.CustomField)}
  const result=applyColumnMapping([source],{name:'name'}).at(0)!.mapped
  for(const key of ['_realmId','_quickbooksId','_quickbooksEntity','_quickbooksRaw','_quickbooksMeta','_quickbooksSyncToken','_quickbooksRelationships','_quickbooksCustomFields'])assert.equal(result[key],source[key as keyof typeof source])
})

test('non-native QuickBooks identifiers are deterministic and idempotent',()=>{
  const exchange={SourceCurrencyCode:'USD',TargetCurrencyCode:'SAR',AsOfDate:'2026-01-02',Rate:3.75}
  assert.equal(stableQuickBooksSourceId('exchange-rates',exchange),'ExchangeRate:USD:SAR:2026-01-02')
  const recurring={Name:'Monthly rent',RecurrenceInfo:{IntervalType:'Monthly',NumInterval:1}}
  assert.equal(stableQuickBooksSourceId('recurring-transactions',recurring),stableQuickBooksSourceId('recurring-transactions',{RecurrenceInfo:{NumInterval:1,IntervalType:'Monthly'},Name:'Monthly rent'}))
})

test('QuickBooks exposes exactly one customer payment import path',()=>{
  const resources=new QuickBooksImportAdapter().resources
  assert.equal(resources.filter(resource=>resource.moduleKey==='customer-payments').length,1)
  assert.equal(resources.some(resource=>resource.key==='payments'),false)
  assert.equal(resources.filter(resource=>['vendor-payments','bill-payments'].includes(resource.key)).length,1)
  assert.equal(resources.filter(resource=>['departments','locations'].includes(resource.key)).length,1)
})

test('dependency ordering places masters, documents, settlements, then deposits',()=>{
  const ordered=orderQuickBooksMigrationResources([{key:'deposits'},{key:'customer-payments'},{key:'invoices'},{key:'customers'},{key:'accounts'}])
  assert.deepEqual(ordered.map(item=>item.key),['accounts','customers','invoices','customer-payments','deposits'])
})

test('database and dependency errors retain structured diagnostics',()=>{
  const database=normalizeImportError({code:'23505',message:'duplicate key violates unique constraint "accounts_company_no_key"',details:'Key already exists',hint:'Use update',table:'chart_of_accounts'})
  assert.deepEqual(database.details,{code:'23505',detail:'Key already exists',hint:'Use update',constraint:'accounts_company_no_key',table:'chart_of_accounts',column:undefined,status:undefined,rootCause:undefined,dependency:undefined})
  const dependency=normalizeImportError(new MissingDependencyError('Invoice 96','Invoice 96 must migrate first.'))
  assert.equal(dependency.errorCode,'MISSING_DEPENDENCY')
  assert.equal(dependency.details.status,'missing_dependency')
})

test('import endpoint always performs authoritative duplicate detection',()=>{
  const route=file('src/app/api/import-export/[module]/import/route.ts')
  assert.match(route,/detectDuplicates\(definition, validRows/)
  assert.doesNotMatch(route,/parseDuplicatesFromBody\(body\)/)
})

test('sampled previews queue source-backed jobs and are never used as import payloads',()=>{
  const wizard=file('src/components/import-export/steps/ConnectedSourceFlow.tsx')
  const route=file('src/app/api/import-export/[module]/import/route.ts')
  const runner=file('src/app/api/import-export/jobs/[jobId]/run/route.ts')
  const registry=file('src/lib/import-export/sources/source-registry.ts')

  assert.match(wizard,/background: true/)
  assert.match(wizard,/sourceKey: source\.key/)
  assert.match(wizard,/resourceKey: resource\.key/)
  assert.match(wizard,/jobs\/\$\{jobId\}\/run/)
  assert.doesNotMatch(wizard,/rows: resource\.rows/)
  assert.doesNotMatch(wizard,/mapping: resource\.mapping/)
  assert.doesNotMatch(wizard,/resource\.count > resource\.rows\.length/)

  assert.match(route,/payloadSnapshot: \{ sourceKey, resourceKey, filename, fileFormat, duplicateStrategy \}/)
  assert.match(route,/fetchSourceResourcePage\(companyId, sourceKey, resourceKey\)/)
  assert.match(route,/rows: normalized\.rows, mapping: fullMapping/)
  assert.match(runner,/job\.payloadSnapshot/)
  assert.match(registry,/fetchWithCheckpoint\(tenantId, source, provider, context, resourceKey/)

  const preview={count:89,rows:Array.from({length:10})}
  assert.equal(preview.count,89)
  assert.equal(preview.rows.length,10)
})

test('QuickBooks import execution is a checkpointed state machine, not one long-lived worker',()=>{
  const route=file('src/app/api/import-export/[module]/import/route.ts')
  const processor=file('src/lib/import-export/import/import-processor.ts')
  const worker=file('src/lib/platform/jobs/workers.ts')
  const queueRoute=file('src/app/api/platform/jobs/route.ts')
  const queue=file('src/lib/platform/jobs/queue.ts')
  const vercel=file('vercel.json')
  const wizard=file('src/components/import-export/steps/ConnectedSourceFlow.tsx')

  assert.match(route,/fetchSourceResourcePage/)
  assert.match(route,/maxBatches: sourcePage \? 1 : undefined/)
  assert.match(route,/sourcePage\.commit\(\)/)
  assert.match(route,/QUICKBOOKS_IMPORT_STEP/)
  assert.match(processor,/maxBatches\?: number/)
  assert.match(processor,/if \(input\.maxBatches && batchesProcessed >= input\.maxBatches\) break/)
  assert.match(worker,/registerJobHandler\('QUICKBOOKS_IMPORT_STEP'/)
  assert.match(queueRoute,/processJobBatch\(1\)/)
  assert.match(queue,/status: 'PENDING'/)
  assert.match(queue,/status', 'RUNNING'/)
  assert.match(vercel,/"schedule": "\* \* \* \* \*"/)
  assert.match(file('src/lib/import-export/sources/source-registry.ts'),/boundedPage: true/)
  assert.match(wizard,/fetch\(.*jobs\/\$\{jobId\}/)
  assert.match(wizard,/estimatedRemaining/)
})

test('Migration Wizard module selection provides a select-all toggle',()=>{
  const wizard=file('src/components/import-export/steps/ConnectedSourceFlow.tsx')
  assert.match(wizard,/function toggleAllModules\(\)/)
  assert.match(wizard,/allModulesSelected \? 'Unselect all' : 'Select all'/)
  assert.match(wizard,/onClick=\{toggleAllModules\}/)
})

test('QuickBooks transaction importer matches the deployed canonical schema',()=>{
  const transactionImporter=file('src/lib/import-export/registry/modules/transactions.module.ts')
  const invoiceRepository=file('src/lib/db/repositories/invoice.repository.supabase.ts')
  assert.doesNotMatch(invoiceRepository,/\n\s*reference: input\.reference/)
  assert.doesNotMatch(transactionImporter,/from\('payments'\)\.select\('amount,currency/)
  assert.doesNotMatch(transactionImporter,/header\.currency=r\.currency/)
  assert.match(transactionImporter,/rollbackTransactionRecord/)
  assert.match(transactionImporter,/assertQuickBooksAccountingCompleted|materializeQuickBooksAccounting/)
})

test('staged extraction avoids retaining a second provider copy and records each checkpoint with its page',()=>{
  const adapter=file('src/lib/import-export/sources/quickbooks.adapter.ts')
  const registry=file('src/lib/import-export/sources/source-registry.ts')
  assert.match(adapter,/retainRows:!options\?\.onBatch/)
  assert.match(adapter,/options\.onBatch!\(this\.normalizeRecords/)
  assert.doesNotMatch(registry,/onCheckpoint:write/)
  assert.match(registry,/await write\(progress\)/)
})

test('exchange-rate extraction uses transaction-authoritative rates instead of paginating the global rate universe',()=>{
  const registry=file('src/lib/import-export/sources/source-registry.ts')
  assert.match(registry,/historicalTransactionExchangeRates/)
  assert.match(registry,/resourceKey,extraction_mode:'full'/)
  assert.match(registry,/from\('quickbooks_extraction_staging'\)[\s\S]*?\.delete\(\)/)
})

test('trusted background migrations resolve the explicit tenant without request cookies',()=>{
  const tenant=file('src/lib/tenant.ts')
  assert.match(tenant,/backgroundTenantContext\.getStore\(\)/)
  assert.match(tenant,/withCompanyContext/)
  assert.match(tenant,/if\(background\?\.companyId\)return background\.companyId/)
})

test('source re-archival never clears a completed native materialization link',()=>{
  const store=file('src/lib/import-export/quickbooks/migration-store.ts')
  assert.match(store,/input\.localId !== undefined \? \{ local_id:input\.localId, imported_at:/)
  assert.doesNotMatch(store,/local_id: input\.localId \?\? null/)
  assert.doesNotMatch(store,/imported_at: input\.localId \? new Date\(\)\.toISOString\(\) : null/)
})

test('extended QuickBooks modules never overwrite native links with table-less IDs',()=>{
  const processor=file('src/lib/import-export/import/import-processor.ts')
  assert.match(processor,/localId:extendedQuickBooksModule\?undefined:localId/)
  const extended=file('src/lib/import-export/registry/modules/quickbooks-extended.module.ts')
  assert.match(extended,/resolveQuickBooksLocalId\(ctx\.companyId,realmId,sourceId,\[config\.entityType\]\)/)
})

test('QuickBooks item adjustment payloads use their canonical line and account references',()=>{
  const extended=file('src/lib/import-export/registry/modules/quickbooks-extended.module.ts')
  assert.match(extended,/line\.ItemAdjustmentLineDetail/)
  const dependencies=file('src/lib/import-export/quickbooks/dependency-check.ts')
  assert.match(dependencies,/raw\.AdjustmentAccountRef \?\? raw\.AdjustAccountRef/)
})

test('idempotency hashes include a mapping version so corrected mappings re-materialize once',()=>{
  const store=file('src/lib/import-export/quickbooks/migration-store.ts')
  assert.match(store,/QUICKBOOKS_MAPPING_VERSION/)
  assert.match(store,/sourcePayloadHash\(raw,entityType\)/)
})

test('QuickBooks inventory items preserve the source negative-stock replay policy',()=>{
  const inventory=file('src/lib/import-export/registry/modules/inventory.module.ts')
  assert.match(inventory,/allow_negative_stock:true/)
  assert.match(inventory,/raw\.Type/)
})

test('parsed import records retain protected provider metadata',()=>{
  const processor=file('src/lib/import-export/import/import-processor.ts')
  assert.match(processor,/\{ \.\.\.row\.mapped, \.\.\.parser\(/)
})

test('ledger posting aggregates same-account source lines before the unique source constraint',()=>{
  const posting=file('src/lib/accounting/posting-service.ts')
  assert.match(posting,/const grouped=new Map<string,PostingLine>/)
  assert.match(posting,/for \(const line of grouped\.values\(\)\)/)
})

test('invoice and bill inventory replay uses a distinct idempotency key per native line',()=>{
  const hooks=readFileSync('src/lib/inventory/document-hooks.ts','utf8')
  assert.match(hooks,/GRN from bill \$\{bill\.bill_no\} line \$\{line\.id\}/)
  assert.match(hooks,/GIN from invoice \$\{invoice\.invoice_no\} line \$\{line\.id\}/)
  assert.doesNotMatch(hooks,/if \(existing && existing\.length > 0\) return/)
})

test('transaction duplicate detection batches source IDs and document numbers',()=>{
  const source=readFileSync('src/lib/import-export/registry/modules/transactions.module.ts','utf8')
  assert.match(source,/async findDuplicatesBatch/)
  assert.match(source,/\.in\('legacy_id',sourceIds\)/)
  assert.match(source,/\.in\(c\.numberColumn,numbers\)/)
  assert.doesNotMatch(source,/for \(const row of rows\) \{ const d=await this\.findDuplicate/)
})

test('record failures preserve the exact pipeline stage',()=>{
  const processor=readFileSync('src/lib/import-export/import/import-processor.ts','utf8')
  assert.match(processor,/recordStage='native_create'/)
  assert.match(processor,/recordStage='accounting_materialization'/)
  assert.match(processor,/details: \{ \.\.\.normalized\.details, stage:recordStage \}/)
})

test('materialization status is scoped to the QuickBooks source identity',()=>{
  const materializer=readFileSync('src/lib/import-export/quickbooks/accounting-materializer.ts','utf8')
  assert.match(materializer,/\.eq\('realm_id',realmId\)\.eq\('entity_type',entityType\)\.eq\('source_id',sourceId\)/)
  assert.match(materializer,/getQuickBooksMaterializationStatus\([^)]*sourceRow\?:Row\)/)
})

test('live verification counts validation-invalid source rows as failures',()=>{
  const runner=readFileSync('scripts/quickbooks/run-live-sandbox-migration.ts','utf8')
  assert.match(runner,/failed:imported\.failedCount\+validation\.invalidRowNumbers\.length/)
  assert.match(runner,/message:`validation: \$\{issue\.message\}`/)
})

test('staging cleanup is bounded, retried, and cannot silently defer a timeout',()=>{
  const registry=readFileSync('src/lib/import-export/sources/source-registry.ts','utf8')
  assert.match(registry,/function clearQuickBooksStaging/)
  assert.match(registry,/attempt <= 3/)
  assert.match(registry,/AbortSignal\.timeout\(60_000\)/)
  assert.doesNotMatch(registry,/staging_cleanup_deferred/)
  assert.match(registry,/trace\.measure\('staging_cleanup'/)
})

test('migration reports deduplicate legacy entity-casing aliases by QuickBooks identity',()=>{
  const report=readFileSync('src/lib/import-export/quickbooks/migration-report-service.ts','utf8')
  assert.match(report,/select\('entity_type,source_id,local_id/)
  assert.match(report,/record\.entity_type\.toLowerCase\(\).*record\.source_id/)
  assert.match(report,/archivedRecords = \[\.\.\.deduplicated\.values\(\)\]/)
})
