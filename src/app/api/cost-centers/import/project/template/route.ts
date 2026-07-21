import { handleCostCenterTemplateDownload } from '@/lib/cost-centers/import/template-handler'

export async function GET() {
  return handleCostCenterTemplateDownload('project')
}
