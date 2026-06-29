import { getAppUser, type AppUser } from './supabase/auth-users'
import { createClient } from './supabase/server'

export type { AppUser }

export async function getSession(): Promise<AppUser | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.getUser()

  if (error || !data.user?.email) {
    return null
  }

  const user = await getAppUser(data.user.id, data.user.email)
  return user.isActive ? user : null
}

export async function requireAuth(): Promise<AppUser> {
  const user = await getSession()
  if (!user) {
    throw new Error('Unauthorized')
  }
  return user
}
