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
  parseDuplicatesFromBody,
  parseFileFormatFromBody,
  parseFilenameFromBody,
} from '../../_lib/parse-import-body'
import type { DuplicateStrategy } from '@/lib/import-export/types'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ module: string }> },
) {
  let jobId: string | null = null

  try {
    const user = await requireAccountingAdmin()
    const { module: moduleKey } = await params
    resolveModuleParam(moduleKey)

    const body = await request.json() as Record<string, unknown>
    const definition = getModuleDefinition(moduleKey)
    const { mappedRows, validation, mapping } = buildMappedImportPayload(definition, body)
    const filename = parseFilenameFromBody(body)
    const fileFormat = parseFileFormatFromBody(body)
    const duplicateStrategy = (['skip', 'update', 'create'].includes(String((body as Record<string, unknown>).duplicateStrategy))
      ? (body as Record<string, unknown>).duplicateStrategy
      : 'skip') as DuplicateStrategy

    const companyId = await resolveCompanyId()
    const existingJobId = typeof body.jobId === 'string' ? body.jobId : null
    const existingJob = existingJobId ? await getImportJob(existingJobId) : null
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
    const duplicateMatches = parseDuplicatesFromBody(body)
      ?? await detectDuplicates(definition, validRows, { companyId, userId: user.id })

    if (body.background === true && !existingJobId) {
      await setImportJobStatus(job.id, 'pending')
      return Response.json({ jobId: job.id, status: 'pending', totalRows: mappedRows.length, batchSize: job.batchSize ?? 250 }, { status: 202 })
    }

    const base = existingJob ? { importedCount: existingJob.importedCount, updatedCount: existingJob.updatedCount, skippedCount: existingJob.skippedCount, failedCount: existingJob.failedCount } : { importedCount: 0, updatedCount: 0, skippedCount: 0, failedCount: 0 }
    const result = await processImport({
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
    })

    const allErrors = [...validationErrors, ...result.errors]
    await saveImportJobErrors(job.id, allErrors)
    const aggregate = { importedCount: base.importedCount + result.importedCount, updatedCount: base.updatedCount + result.updatedCount, skippedCount: base.skippedCount + result.skippedCount, failedCount: base.failedCount + result.failedCount }

    if (result.paused) {
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

    const finalized = await finalizeImportJob(job.id, {
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
    })

    return Response.json({
      jobId: finalized.id,
      status: finalized.status,
      importedCount: finalized.importedCount,
      updatedCount: finalized.updatedCount,
      skippedCount: finalized.skippedCount,
      failedCount: finalized.failedCount,
      totalRows: finalized.totalRows,
      durationMs: finalized.durationMs,
    })
  } catch (error) {
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
          errorCode: 'IMPORT_FATAL',
          message: error instanceof Error ? error.message : 'Import failed unexpectedly',
        }])
      } catch {
        // Best-effort job finalization.
      }
    }
    return apiError(error)
  }
}
