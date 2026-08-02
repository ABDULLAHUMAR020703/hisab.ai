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
import { fetchSourceResource, getImportSource } from '@/lib/import-export/sources/source-registry'
import { FrameworkBadRequestError } from '@/lib/import-export/errors'

async function handleImport(
  request: Request,
  { params }: { params: Promise<{ module: string }> },
  trace: MigrationTrace,
) {
  let jobId: string | null = null

  try {
    const { user, moduleKey } = await trace.measure('module_scheduling', async () => {
      const authenticated = await requireAccountingAdmin()
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
      const normalized = await trace.measure('extraction', () => fetchSourceResource(companyId, sourceKey, resourceKey))
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
        await updateImportJobProgress(job.id, processed, counts?{
          importedCount:base.importedCount+counts.importedCount,
          updatedCount:base.updatedCount+counts.updatedCount,
          skippedCount:base.skippedCount+counts.skippedCount,
          failedCount:base.failedCount+counts.failedCount,
        }:undefined)
      },
      isCancelled: () => isJobCancelled(job.id),
      isPaused: () => isJobPaused(job.id),
      startAt: job.batchCursor ?? 0,
      batchSize: job.batchSize ?? 250,
      trace,
    }))

    const allErrors = [...validationErrors, ...result.errors]
    await saveImportJobErrors(job.id, allErrors)
    const aggregate = { importedCount: base.importedCount + result.importedCount, updatedCount: base.updatedCount + result.updatedCount, skippedCount: base.skippedCount + result.skippedCount, failedCount: base.failedCount + result.failedCount }

    if (result.paused) {
      trace.finish({ fetched:mappedRows.length, imported:aggregate.importedCount, updated:aggregate.updatedCount, skipped:aggregate.skippedCount, failed:aggregate.failedCount })
      return Response.json({
        jobId: job.id,
        status: 'paused',
        ...aggregate,
        totalRows: mappedRows.length,
        durationMs: Date.now() - new Date(job.startedAt ?? Date.now()).getTime(),
      })
    }

    const cancelled = await isJobCancelled(job.id)
    const invalidRowCount = validation.invalidRowNumbers.length
    const status = cancelled
      ? 'cancelled'
      : aggregate.failedCount > 0 && aggregate.importedCount === 0 && aggregate.updatedCount === 0
        ? 'failed'
        : 'completed'

    const finalized = await trace.measure('report_generation', () => finalizeImportJob(job.id, {
      status,
      importedCount: aggregate.importedCount,
      updatedCount: aggregate.updatedCount,
      skippedCount: aggregate.skippedCount + invalidRowCount,
      failedCount: aggregate.failedCount,
      totalRows: mappedRows.length,
      validRows: validation.validRowNumbers.length,
      invalidRows: invalidRowCount,
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
