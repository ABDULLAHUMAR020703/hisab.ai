import { handleCostCenterTypedImport } from '@/lib/cost-centers/import/api-handler'

export async function POST(request: Request) {
  return handleCostCenterTypedImport(request, 'class')
}
