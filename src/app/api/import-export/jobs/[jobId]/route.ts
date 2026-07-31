import { requireAuth } from '@/lib/auth'
import { getImportJob } from '@/lib/import-export/jobs/import-job.service'
import { apiError } from '@/lib/import-export/api-helpers'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  try {
    await requireAuth()
    const { jobId } = await params
    const job = await getImportJob(jobId)
    if (!job) {
      return Response.json({ error: 'Job not found' }, { status: 404 })
    }

    return Response.json({
      id: job.id,
      status: job.status,
      totalRows: job.totalRows,
      processedRows: job.processedRows,
      importedCount: job.importedCount,
      updatedCount: job.updatedCount,
      skippedCount: job.skippedCount,
      failedCount: job.failedCount,
      durationMs: job.durationMs,
      completedAt: job.completedAt,
      batchSize: job.batchSize,
      batchCursor: job.batchCursor,
      retryCount: job.retryCount,
      pausedAt: job.pausedAt,
      progressPercent: job.totalRows ? Math.round((job.processedRows / job.totalRows) * 10000) / 100 : 0,
    })
  } catch (error) {
    return apiError(error)
  }
}
