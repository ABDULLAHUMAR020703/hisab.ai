import { requireAccountingAdmin } from '@/lib/product-parity/permissions'
import { getImportJob, incrementImportJobRetry } from '@/lib/import-export/jobs/import-job.service'
import { apiError } from '@/lib/import-export/api-helpers'
import { POST as importModule } from '../../../[module]/import/route'

export async function POST(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    await requireAccountingAdmin(); const { jobId } = await params; const job = await getImportJob(jobId)
    if (!job) return Response.json({ error: 'Job not found' }, { status: 404 })
    if (!job.payloadSnapshot) return Response.json({ error: 'Job payload is unavailable.' }, { status: 409 })
    await incrementImportJobRetry(jobId)
    return importModule(new Request('http://internal/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...job.payloadSnapshot, jobId }) }), { params: Promise.resolve({ module: job.moduleKey }) })
  } catch (error) { return apiError(error) }
}
