/**
 * Supabase environment configuration.
 */

export function getSupabaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL
  if (!url) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL)')
  }
  return url
}

export function getSupabaseAnonKey(): string {
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY
  if (!key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_ANON_KEY (or SUPABASE_ANON_KEY)')
  }
  return key
}

export function getSupabaseServiceRoleKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) {
    throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY')
  }
  return key
}

/** When true, repositories and future routes use Supabase instead of Prisma. */
export function isSupabaseEnabled(): boolean {
  if (process.env.USE_SUPABASE === 'true') return true
  if (process.env.USE_SUPABASE === 'false') return false
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL
  const db = process.env.DATABASE_URL ?? ''
  return Boolean(url) && db.startsWith('postgres')
}

export const DEFAULT_COMPANY_ID = '00000000-0000-4000-8000-000000000001'
