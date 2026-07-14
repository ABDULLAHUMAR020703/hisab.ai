import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCompanyId } from '@/lib/tenant'
import { generateApiKey, checkRateLimit, hasScope, hashApiKey } from './helpers'

export { generateApiKey, checkRateLimit, hasScope } from './helpers'

export async function createApiKey(input: {
  name: string
  scopes: string[]
  rateLimitPerMinute?: number
  expiresAt?: string | null
  createdById?: string | null
  companyId?: string
}) {
  const companyId = input.companyId ?? await resolveCompanyId()
  const { raw, prefix, hash } = generateApiKey()
  const client = createAdminClient()

  const { data, error } = await client
    .from('api_keys')
    .insert({
      company_id: companyId,
      name: input.name,
      key_prefix: prefix,
      key_hash: hash,
      scopes: input.scopes,
      rate_limit_per_minute: input.rateLimitPerMinute ?? 60,
      expires_at: input.expiresAt ?? null,
      created_by_id: input.createdById ?? null,
    })
    .select('id, name, key_prefix, scopes, rate_limit_per_minute, expires_at, created_at')
    .single()

  if (error) throw error
  return { ...data, apiKey: raw }
}

export async function validateApiKey(rawKey: string) {
  const hash = hashApiKey(rawKey)
  const client = createAdminClient()
  const { data } = await client
    .from('api_keys')
    .select('*')
    .eq('key_hash', hash)
    .eq('is_active', true)
    .maybeSingle()

  if (!data) return null
  if (data.expires_at && new Date(String(data.expires_at)) < new Date()) return null

  await client.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', data.id)
  return data
}

export async function logApiUsage(input: {
  companyId: string
  apiKeyId?: string | null
  method: string
  path: string
  statusCode?: number
  durationMs?: number
  ipAddress?: string
}) {
  const client = createAdminClient()
  await client.from('api_usage_logs').insert({
    company_id: input.companyId,
    api_key_id: input.apiKeyId ?? null,
    method: input.method,
    path: input.path,
    status_code: input.statusCode ?? null,
    duration_ms: input.durationMs ?? null,
    ip_address: input.ipAddress ?? null,
  })
}

