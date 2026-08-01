import 'server-only'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { getSupabaseServiceRoleKey, getSupabaseUrl } from './env'
import { diagnosticFetch } from '@/lib/ops/external-request-diagnostics'

/** Service-role client — bypasses RLS. Server-only; never expose to the browser. */
export function createAdminClient() {
  return createSupabaseClient(getSupabaseUrl(), getSupabaseServiceRoleKey(), {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: { fetch: diagnosticFetch },
  })
}
