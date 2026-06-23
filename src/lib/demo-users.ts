import { ensureDemoSupabaseUsers } from './supabase/auth-users'

export async function ensureDemoUsers() {
  await ensureDemoSupabaseUsers()
}
