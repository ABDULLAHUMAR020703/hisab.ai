import { requireRole, authzErrorResponse } from '@/lib/authz'
import { listExpenseTransactions } from '@/lib/expense-transactions/service'

export async function GET(request: Request) {
  try {
    const user = await requireRole(['OWNER', 'ADMIN', 'ACCOUNTANT', 'MANAGER', 'AUDITOR'])
    return Response.json(await listExpenseTransactions(user.companyId, request.url))
  } catch (error) { return authzErrorResponse(error) }
}
