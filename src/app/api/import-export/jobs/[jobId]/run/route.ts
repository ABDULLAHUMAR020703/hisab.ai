import { requireAccountingAdmin } from '@/lib/product-parity/permissions'
import { getImportJob, setImportJobStatus } from '@/lib/import-export/jobs/import-job.service'
import { resolveCompanyId } from '@/lib/tenant'
import { apiError } from '@/lib/import-export/api-helpers'
import { enqueueJob } from '@/lib/platform/jobs/queue'
import { logger } from '@/lib/ops/logger'

export async function POST(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const user = await requireAccountingAdmin(); const { jobId } = await params; const job = await getImportJob(jobId)
    if (!job) return Response.json({ error: 'Job not found' }, { status: 404 })
    if (!job.payloadSnapshot) return Response.json({ error: 'Job payload is unavailable.' }, { status: 409 })
    const companyId = await resolveCompanyId()
    await setImportJobStatus(jobId, 'pending')
    logger.info('quickbooks.worker.import_step.enqueued', { platformJobId: null, importJobId: job.id, companyId, userId: user.id, module: job.moduleKey })
    await enqueueJob({ jobType: 'QUICKBOOKS_IMPORT_STEP', companyId, payload: { importJobId: job.id, moduleKey: job.moduleKey, companyId, userId: user.id } })
    return Response.json({ jobId: job.id, status: 'pending', totalRows: job.totalRows, processedRows: job.processedRows }, { status: 202 })
  } catch (error) { return apiError(error) }
}
