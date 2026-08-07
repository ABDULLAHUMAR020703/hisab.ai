import { requireAccountingRead as requireAuth } from '@/lib/product-parity/permissions'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiError } from '@/lib/import-export/api-helpers'

export async function GET() { try { const user = await requireAuth(); const { data, error } = await createAdminClient().from('accounting_sync_runs').select('*').eq('company_id', user.companyId).eq('provider', 'quickbooks').order('started_at', { ascending: false }).limit(50); if (error) throw error; return Response.json(data ?? []) } catch (error) { return apiError(error) } }
