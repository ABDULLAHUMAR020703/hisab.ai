import { requireRole, authzErrorResponse } from '@/lib/authz'
import { exportExpenseTransactions } from '@/lib/expense-transactions/service'

export async function GET(request: Request) {
  try {
    const user = await requireRole(['OWNER', 'ADMIN', 'ACCOUNTANT', 'MANAGER', 'AUDITOR'])
    const csv = await exportExpenseTransactions(user.companyId, request.url)
    return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="expense-transactions.csv"', 'Cache-Control': 'private, no-store' } })
  } catch (error) { return authzErrorResponse(error) }
}
