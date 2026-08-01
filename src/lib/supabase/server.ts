import 'server-only'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { getSupabaseAnonKey, getSupabaseUrl } from './env'
import { diagnosticFetch } from '@/lib/ops/external-request-diagnostics'

/** User-scoped Supabase client (respects RLS via session JWT). */
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    global: { fetch: diagnosticFetch },
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options)
          }
        } catch {
          // setAll can fail in Server Components; middleware handles refresh.
        }
      },
    },
  })
}
