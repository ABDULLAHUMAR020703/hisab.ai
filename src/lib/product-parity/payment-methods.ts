import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'

export async function resolvePaymentMethod(companyId: string, paymentMethodId?: unknown, fallbackCode = 'BANK_TRANSFER') {
  const client = createAdminClient()
  let query = client.from('payment_methods').select('id,code,name,method_type').eq('company_id', companyId).eq('is_active', true).is('deleted_at', null)
  query = typeof paymentMethodId === 'string' && paymentMethodId ? query.eq('id', paymentMethodId) : query.eq('code', fallbackCode)
  const { data, error } = await query.maybeSingle()
  if (error) throw error
  if (!data) throw new Error('Select an active payment method.')
  return data
}
