import { requireAuth } from '@/lib/auth'
import { resolveCompanyId } from '@/lib/tenant'
import { detectDuplicates } from '@/lib/import-export/duplicate/duplicate-detector'
import { getModuleDefinition } from '@/lib/import-export/registry/module-registry'
import {
  createImportJob,
  finalizeImportJob,
  getImportJob,
  isJobCancelled,
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
    const user = await requireAuth()
    const { module: moduleKey } = await params
    resolveModuleParam(moduleKey)

    const body = await request.json()
    const module = getModuleDefinition(moduleKey)
    const { mappedRows, validation, mapping } = buildMappedImportPayload(module, body)
    const filename = parseFilenameFromBody(body)
    const fileFormat = parseFileFormatFromBody(body)
    const duplicateStrategy = (['skip', 'update', 'create'].includes(String((body as Record<string, unknown>).duplicateStrategy))
      ? (body as Record<string, unknown>).duplicateStrategy
      : 'skip') as DuplicateStrategy

    const companyId = await resolveCompanyId()
    const job = await createImportJob({
      userId: user.id,
      moduleKey,
      filename,
      fileFormat,
      duplicateStrategy,
      mappingSnapshot: mappingSnapshot(mapping),
      totalRows: mappedRows.length,
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
      ?? await detectDuplicates(module, validRows, { companyId, userId: user.id })

    const result = await processImport({
      module,
      rows: mappedRows,
      validation,
      duplicateStrategy,
      duplicateMatches,
      ctx: { companyId, userId: user.id },
      onProgress: async (processed) => {
        await updateImportJobProgress(job.id, processed)
      },
      isCancelled: () => isJobCancelled(job.id),
    })

    const allErrors = [...validationErrors, ...result.errors]
    await saveImportJobErrors(job.id, allErrors)

    const cancelled = await isJobCancelled(job.id)
    const invalidRowCount = validation.invalidRowNumbers.length
    const status = cancelled
      ? 'cancelled'
      : result.failedCount > 0 && result.importedCount === 0 && result.updatedCount === 0
        ? 'failed'
        : 'completed'

    const finalized = await finalizeImportJob(job.id, {
      status,
      importedCount: result.importedCount,
      updatedCount: result.updatedCount,
      skippedCount: result.skippedCount + invalidRowCount,
      failedCount: result.failedCount,
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
