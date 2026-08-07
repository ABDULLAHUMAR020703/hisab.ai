import { requireAccountingAdmin } from '@/lib/product-parity/permissions'
import { recoverStaleImportJobs } from '@/lib/import-export/jobs/import-job.service'
import { apiError } from '@/lib/import-export/api-helpers'

export async function POST() {
  try { await requireAccountingAdmin(); return Response.json({ recovered: await recoverStaleImportJobs() }) } catch (error) { return apiError(error) }
}
