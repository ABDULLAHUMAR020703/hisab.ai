import { authzErrorResponse } from '@/lib/authz'
import { requireAccountingAdmin,requireAccountingRead } from '@/lib/product-parity/permissions'
import { getCutoffReconciliations,runCutoffReconciliation } from '@/lib/quickbooks-cutoff/service'

export async function GET(request:Request){try{const user=await requireAccountingRead();const id=new URL(request.url).searchParams.get('id')??undefined;return Response.json(await getCutoffReconciliations(user.companyId,id),{headers:{'Cache-Control':'no-store'}})}catch(error){return authzErrorResponse(error)}}
export async function POST(request:Request){try{const user=await requireAccountingAdmin();return Response.json(await runCutoffReconciliation(user.companyId,user.id,await request.json()),{status:201,headers:{'Cache-Control':'no-store'}})}catch(error){return authzErrorResponse(error)}}
