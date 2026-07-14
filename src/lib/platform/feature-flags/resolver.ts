import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCompanyId } from '@/lib/tenant'

export async function isFeatureEnabled(
  flagKey: string,
  context?: { companyId?: string; branchId?: string; userId?: string },
): Promise<boolean> {
  const client = createAdminClient()
  const companyId = context?.companyId ?? await resolveCompanyId().catch(() => null)

  const { data: flag } = await client
    .from('feature_flags')
    .select('*')
    .eq('flag_key', flagKey)
    .maybeSingle()

  if (!flag) return false

  let query = client.from('feature_flag_overrides').select('is_enabled').eq('flag_id', flag.id)
  if (companyId) query = query.eq('company_id', companyId)
  if (context?.branchId) query = query.eq('branch_id', context.branchId)
  if (context?.userId) query = query.eq('user_id', context.userId)

  const { data: overrides } = await query.order('created_at', { ascending: false }).limit(1)
  if (overrides?.[0]) return overrides[0].is_enabled

  if (flag.rollout_percent > 0 && flag.rollout_percent < 100 && companyId) {
    const hash = companyId.charCodeAt(0) % 100
    return hash < flag.rollout_percent
  }

  return flag.default_enabled
}

export async function setFeatureOverride(input: {
  flagKey: string
  isEnabled: boolean
  companyId?: string
  branchId?: string | null
  userId?: string | null
}) {
  const client = createAdminClient()
  const companyId = input.companyId ?? await resolveCompanyId()

  const { data: flag } = await client.from('feature_flags').select('id').eq('flag_key', input.flagKey).single()
  if (!flag) throw new Error(`Unknown flag: ${input.flagKey}`)

  const { data, error } = await client
    .from('feature_flag_overrides')
    .insert({
      flag_id: flag.id,
      company_id: companyId,
      branch_id: input.branchId ?? null,
      user_id: input.userId ?? null,
      is_enabled: input.isEnabled,
    })
    .select('*')
    .single()

  if (error) throw error
  return data
}

export async function listFeatureFlags() {
  const client = createAdminClient()
  const { data, error } = await client.from('feature_flags').select('*').order('flag_key')
  if (error) throw error
  return data ?? []
}
