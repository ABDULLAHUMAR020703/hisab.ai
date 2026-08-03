import { randomUUID } from 'node:crypto'
import { resolveCompanyId } from '@/lib/tenant'
import { requireAccountingAdmin } from '@/lib/product-parity/permissions'
import { detectDuplicates } from '@/lib/import-export/duplicate/duplicate-detector'
import { getModuleDefinition } from '@/lib/import-export/registry/module-registry'
import {
  createImportJob,
  finalizeImportJob,
  getImportJob,
  isJobCancelled,
  isJobPaused,
  setImportJobStatus,
  saveImportJobErrors,
  updateImportJobProgress,
} from '@/lib/import-export/jobs/import-job.service'
import { mappingSnapshot } from '@/lib/import-export/mapping/auto-mapper'
import { processImport } from '@/lib/import-export/import/import-processor'
import { apiError } from '@/lib/import-export/api-helpers'
import { resolveModuleParam } from '../../_lib/module-params'
import {
  buildMappedImportPayload,
  parseFileFormatFromBody,
  parseFilenameFromBody,
} from '../../_lib/parse-import-body'
import type { DuplicateStrategy } from '@/lib/import-export/types'
import { normalizeImportError } from '@/lib/import-export/import/import-error'
import { CORRELATION_HEADER, getCorrelationId } from '@/lib/ops/correlation'
import { withExternalRequestDiagnostics } from '@/lib/ops/external-request-diagnostics'
import { MigrationTrace } from '@/lib/import-export/quickbooks/migration-telemetry'
import { fetchSourceResourcePage, getImportSource } from '@/lib/import-export/sources/source-registry'
import { FrameworkBadRequestError } from '@/lib/import-export/errors'
import { enqueueJob } from '@/lib/platform/jobs/queue'
import { withCompanyContext } from '@/lib/tenant'
import type { MigrationActivityEvent, MigrationProgressSnapshot } from '@/lib/import-export/types'

async function handleImport(
  request: Request,
  { params }: { params: Promise<{ module: string }> },
  trace: MigrationTrace,
  backgroundUser?: { id: string },
) {
  let jobId: string | null = null
  let sourcePage: Awaited<ReturnType<typeof fetchSourceResourcePage>> | null = null

  try {
    const { user, moduleKey } = await trace.measure('module_scheduling', async () => {
      const authenticated = backgroundUser ?? await requireAccountingAdmin()
      const { module: resolvedModule } = await params
      resolveModuleParam(resolvedModule)
      return { user: authenticated, moduleKey: resolvedModule }
    })

    const body = await request.json() as Record<string, unknown>
    const definition = getModuleDefinition(moduleKey)
    const filename = parseFilenameFromBody(body)
    const fileFormat = parseFileFormatFromBody(body)
    const duplicateStrategy = (['skip', 'update', 'create'].includes(String((body as Record<string, unknown>).duplicateStrategy))
      ? (body as Record<string, unknown>).duplicateStrategy
      : 'skip') as DuplicateStrategy

    const companyId = await resolveCompanyId()
    const existingJobId = typeof body.jobId === 'string' ? body.jobId : null
    const existingJob = existingJobId ? await getImportJob(existingJobId) : null
    if (existingJobId && !existingJob) return Response.json({ error: 'Import job not found.' }, { status: 404 })
    const sourceKey = typeof body.sourceKey === 'string' ? body.sourceKey : ''
    const resourceKey = typeof body.resourceKey === 'string' ? body.resourceKey : ''
    const sourceResource = sourceKey && resourceKey
      ? getImportSource(sourceKey).resources.find((resource) => resource.key === resourceKey)
      : undefined
    if ((sourceKey || resourceKey) && (!sourceResource || sourceResource.moduleKey !== moduleKey)) {
      throw new FrameworkBadRequestError('The selected source resource does not match the import module.')
    }

    // Source-backed background jobs deliberately persist only source identity
    // and user choices. Preview rows and mappings are never job input.
    if (body.background === true && !existingJobId && sourceResource) {
      const queued = await createImportJob({
        userId: user.id,
        moduleKey,
        filename,
        fileFormat,
        duplicateStrategy,
        totalRows: 0,
        mappingSnapshot: {},
        payloadSnapshot: { sourceKey, resourceKey, filename, fileFormat, duplicateStrategy },
      })
      jobId = queued.id
      await setImportJobStatus(queued.id, 'pending')
      trace.finish({ fetched: 0 })
      return Response.json({ jobId: queued.id, status: 'pending', totalRows: 0, batchSize: queued.batchSize ?? 250 }, { status: 202 })
    }

    let importBody = body
    if (existingJob && sourceResource) {
      sourcePage = await trace.measure('extraction', () => fetchSourceResourcePage(companyId, sourceKey, resourceKey))
      const normalized = sourcePage.resource
      const fullMapping = Object.fromEntries(definition.fields
        .filter((field) => field.importable !== false)
        .map((field) => [field.key, field.key]))
      importBody = { ...body, rows: normalized.rows, mapping: fullMapping }
    }
    const { mappedRows, validation, mapping } = await trace.measure('validation', () => buildMappedImportPayload(definition, importBody))
    const job = existingJob ?? await createImportJob({
      userId: user.id, moduleKey, filename, fileFormat, duplicateStrategy,
      mappingSnapshot: mappingSnapshot(mapping), totalRows: mappedRows.length,
      payloadSnapshot: { rows: mappedRows, validation, mapping, filename, fileFormat, duplicateStrategy },
    })
    jobId = job.id

    const validationErrors = validation.issues
      .filter((issue) => issue.severity === 'error')
      .map((issue) => ({
        rowNumber: issue.rowNumber,
        fieldKey: issue.fieldKey,
        errorCode: issue.code,
        message: issue.message,
      }))

    const validRows = mappedRows.filter((row) => validation.validRowNumbers.includes(row.rowNumber))
    // Client/preview duplicate results are advisory only. Import always checks
    // the authoritative tenant data immediately before applying a strategy.
    const duplicateMatches = await trace.measure('duplicate_detection', () => detectDuplicates(definition, validRows, { companyId, userId: user.id }))

    if (body.background === true && !existingJobId) {
      await setImportJobStatus(job.id, 'pending')
      trace.finish({ fetched:mappedRows.length })
      return Response.json({ jobId: job.id, status: 'pending', totalRows: mappedRows.length, batchSize: job.batchSize ?? 250 }, { status: 202 })
    }

    const base = existingJob ? { importedCount: existingJob.importedCount, updatedCount: existingJob.updatedCount, skippedCount: existingJob.skippedCount, failedCount: existingJob.failedCount } : { importedCount: 0, updatedCount: 0, skippedCount: 0, failedCount: 0 }
    const result = await trace.measure('materialization', () => processImport({
      module:definition,
      rows: mappedRows,
      validation,
      duplicateStrategy,
      duplicateMatches,
      ctx: { companyId, userId: user.id },
      onProgress: async (processed, _total, counts) => {
        trace?.setTotals(processed, _total)
        await updateImportJobProgress(job.id, processed, counts?{
          importedCount:base.importedCount+counts.importedCount,
          updatedCount:base.updatedCount+counts.updatedCount,
          skippedCount:base.skippedCount+counts.skippedCount,
          failedCount:base.failedCount+counts.failedCount,
        }:undefined, sourcePage?.checkpoint.fetched, {
          progressSnapshot: trace?.snapshot() as MigrationProgressSnapshot,
          activityEvent: { id: randomUUID(), at: new Date().toISOString(), type: 'batch_completed', message: `Processed ${processed.toLocaleString()} records`, module: definition.key, stage: 'materialization', batch: Math.ceil(processed / Math.max(1, sourcePage ? 100 : job.batchSize ?? 250)), records: processed },
        })
      },
      isCancelled: () => isJobCancelled(job.id),
      isPaused: () => isJobPaused(job.id),
      startAt: sourcePage ? 0 : job.batchCursor ?? 0,
      batchSize: sourcePage ? 100 : job.batchSize ?? 250,
      maxBatches: sourcePage ? 1 : undefined,
      trace,
    }))

    const allErrors = [...validationErrors, ...result.errors]
    await saveImportJobErrors(job.id, allErrors)
    const aggregate = { importedCount: base.importedCount + result.importedCount, updatedCount: base.updatedCount + result.updatedCount, skippedCount: base.skippedCount + result.skippedCount, failedCount: base.failedCount + result.failedCount }
    const invalidRowCount = validation.invalidRowNumbers.length
    const aggregateSkippedCount = aggregate.skippedCount + invalidRowCount
    const cancelledAfterBatch = await isJobCancelled(job.id)

    if (result.paused || cancelledAfterBatch) {
      await setImportJobStatus(job.id, result.paused ? 'paused' : 'pending')
      trace.finish({ fetched: sourcePage?.checkpoint.fetched ?? mappedRows.length, imported: aggregate.importedCount, updated: aggregate.updatedCount, skipped: aggregate.skippedCount, failed: aggregate.failedCount })
      return Response.json({ jobId: job.id, status: result.paused ? 'paused' : 'cancelled', ...aggregate, totalRows: sourcePage?.checkpoint.fetched ?? mappedRows.length, validRows: validation.validRowNumbers.length, invalidRows: validation.invalidRowNumbers.length, warningCount: validation.warningCount, durationMs: Date.now() - new Date(job.startedAt ?? Date.now()).getTime() })
    }

    if (sourcePage?.hasMore) {
      await sourcePage.commit()
      await updateImportJobProgress(job.id, sourcePage.checkpoint.fetched, { ...aggregate, skippedCount: aggregateSkippedCount, validRows: (job.validRows ?? 0) + validation.validRowNumbers.length, invalidRows: (job.invalidRows ?? 0) + invalidRowCount, warningCount: (job.warningCount ?? 0) + validation.warningCount }, sourcePage.checkpoint.fetched)
      await setImportJobStatus(job.id, 'pending')
      await enqueueJob({ jobType: 'QUICKBOOKS_IMPORT_STEP', companyId, payload: { importJobId: job.id, moduleKey, companyId, userId: user.id } })
      trace.finish({ fetched: sourcePage.checkpoint.fetched, imported: aggregate.importedCount, updated: aggregate.updatedCount, skipped: aggregate.skippedCount, failed: aggregate.failedCount })
      return Response.json({
        jobId: job.id,
        status: 'pending',
        ...aggregate,
        skippedCount: aggregateSkippedCount,
        totalRows: sourcePage.checkpoint.fetched,
        validRows: validation.validRowNumbers.length,
        invalidRows: validation.invalidRowNumbers.length,
        warningCount: validation.warningCount,
        durationMs: Date.now() - new Date(job.startedAt ?? Date.now()).getTime(),
      })
    }

    if (sourcePage) await sourcePage.commit()

    const status = aggregate.failedCount > 0 && aggregate.importedCount === 0 && aggregate.updatedCount === 0
        ? 'failed'
        : 'completed'

    const finalized = await trace.measure('report_generation', () => finalizeImportJob(job.id, {
      status,
      importedCount: aggregate.importedCount,
      updatedCount: aggregate.updatedCount,
      skippedCount: aggregateSkippedCount,
      failedCount: aggregate.failedCount,
      totalRows: sourcePage?.checkpoint.fetched ?? mappedRows.length,
      validRows: (existingJob?.validRows ?? 0) + validation.validRowNumbers.length,
      invalidRows: (existingJob?.invalidRows ?? 0) + invalidRowCount,
      warningCount: validation.warningCount,
      validationSummary: validation.summaryByCode,
      errorSummary: allErrors.reduce<Record<string, number>>((acc, item) => {
        acc[item.errorCode] = (acc[item.errorCode] ?? 0) + 1
        return acc
      }, {}),
      startedAt: job.startedAt,
    }))

    trace.finish({ fetched:mappedRows.length, imported:finalized.importedCount, updated:finalized.updatedCount, skipped:finalized.skippedCount, failed:finalized.failedCount })
    return Response.json({
      jobId: finalized.id,
      status: finalized.status,
      importedCount: finalized.importedCount,
      updatedCount: finalized.updatedCount,
      skippedCount: finalized.skippedCount,
      failedCount: finalized.failedCount,
      totalRows: finalized.totalRows,
      validRows: finalized.validRows,
      invalidRows: finalized.invalidRows,
      warningCount: finalized.warningCount,
      durationMs: finalized.durationMs,
      errors: allErrors,
    })
  } catch (error) {
    const normalized=normalizeImportError(error)
    if (jobId) {
      try {
        const existing = await getImportJob(jobId)
        await finalizeImportJob(jobId, {
          status: 'failed',
          importedCount: existing?.importedCount ?? 0,
          updatedCount: existing?.updatedCount ?? 0,
          skippedCount: existing?.skippedCount ?? 0,
          failedCount: existing?.failedCount ?? 0,
          totalRows: existing?.totalRows ?? 0,
          startedAt: existing?.startedAt,
        })
        await saveImportJobErrors(jobId, [{
          rowNumber: 0,
          errorCode: normalized.errorCode === 'IMPORT_FAILED' ? 'IMPORT_FATAL' : normalized.errorCode,
          message: normalized.message,
          details: normalized.details,
          rawRow: { _importError:normalized.details },
        }])
      } catch {
        // Best-effort job finalization.
      }
    }
    trace.finish()
    const response=apiError(error)
    if([401,403,404].includes(response.status))return response
    const status=normalized.details.status==='missing_dependency'?409:500
    return Response.json({ error:normalized.message, errorCode:normalized.errorCode, details:normalized.details },{status})
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ module: string }> },
) {
  const resolved = await params
  const trace = new MigrationTrace(resolved.module, getCorrelationId(request))
  const response = await withExternalRequestDiagnostics(
    { correlationId:trace.correlationId, module:resolved.module, onRequest:trace.request },
    () => handleImport(request, { params:Promise.resolve(resolved) }, trace),
  )
  response.headers.set(CORRELATION_HEADER, trace.correlationId)
  return response
}

/** Executes one bounded migration unit from the durable platform queue. */
export async function runImportJobStep(jobId: string, companyId: string, userId: string) {
  return withCompanyContext(companyId, async () => {
    const job = await getImportJob(jobId)
    if (!job) return Response.json({ error: 'Import job not found.' }, { status: 404 })
    let progressWrite = Promise.resolve()
    const trace = new MigrationTrace(job.moduleKey, undefined, {
      onEvent: (event, snapshot) => {
        progressWrite = progressWrite.then(() => updateImportJobProgress(job.id, job.processedRows, undefined, job.totalRows || snapshot.estimatedTotalRecords, {
          progressSnapshot: snapshot as MigrationProgressSnapshot,
          activityEvent: event as MigrationActivityEvent,
        })).catch(() => undefined)
      },
    })
    const response = await withExternalRequestDiagnostics(
      { correlationId: trace.correlationId, module: job.moduleKey, onRequest: trace.request },
      () => handleImport(
        new Request('http://internal/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...(job.payloadSnapshot ?? {}), jobId }),
        }),
        { params: Promise.resolve({ module: job.moduleKey }) },
        trace,
        { id: userId },
      ),
    )
    await progressWrite
    return response
  })
}
