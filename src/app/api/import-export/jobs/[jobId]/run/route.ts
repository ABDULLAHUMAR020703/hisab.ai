import { requireAccountingAdmin } from '@/lib/product-parity/permissions'
import { getImportJob, setImportJobStatus } from '@/lib/import-export/jobs/import-job.service'
import { resolveCompanyId } from '@/lib/tenant'
import { apiError } from '@/lib/import-export/api-helpers'
import { runImportJobStep } from '../../../[module]/import/route'

export async function POST(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const user = await requireAccountingAdmin(); const { jobId } = await params; const job = await getImportJob(jobId)
    if (!job) return Response.json({ error: 'Job not found' }, { status: 404 })
    if (!job.payloadSnapshot) return Response.json({ error: 'Job payload is unavailable.' }, { status: 409 })
    await setImportJobStatus(jobId, 'processing')
    return runImportJobStep(jobId, await resolveCompanyId(), user.id)
  } catch (error) { return apiError(error) }
}
