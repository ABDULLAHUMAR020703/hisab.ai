import { createBrowserClient } from '@supabase/ssr'
import { getSupabaseAnonKey, getSupabaseUrl } from './env'

/** Browser Supabase client for client components. */
export function createClient() {
  return createBrowserClient(getSupabaseUrl(), getSupabaseAnonKey())
}
