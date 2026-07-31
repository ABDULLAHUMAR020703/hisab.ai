import { requireAccountingAdmin,requireAccountingRead } from '@/lib/product-parity/permissions'
import { getQuickBooksSyncSettings, saveQuickBooksSyncSettings, syncQuickBooks } from '@/lib/accounting/quickbooks-sync'
import { apiError } from '@/lib/import-export/api-helpers'

export async function GET() { try { const user = await requireAccountingRead(); return Response.json(await getQuickBooksSyncSettings(user.companyId)) } catch (error) { return apiError(error) } }
export async function PATCH(request: Request) { try { const user = await requireAccountingAdmin(); const body = await request.json(); return Response.json(await saveQuickBooksSyncSettings(user.companyId, body)) } catch (error) { return apiError(error) } }
export async function POST(request: Request) { try { const user = await requireAccountingAdmin(); const body = await request.json(); return Response.json(await syncQuickBooks(user.companyId, user.id, body)) } catch (error) { return apiError(error) } }
