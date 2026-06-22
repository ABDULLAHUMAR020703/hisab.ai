import { cookies } from 'next/headers'
import { createPasswordAuthClient, getAppUser, type AppUser } from './supabase/auth-users'

const ACCESS_COOKIE = 'session'
const REFRESH_COOKIE = 'refresh_session'
const WEEK = 7 * 24 * 60 * 60

function sessionCookieOptions(maxAge: number) {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    maxAge,
  }
}

async function refreshSession(refreshToken: string): Promise<AppUser | null> {
  const supabase = createPasswordAuthClient()
  const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken })
  if (error || !data.session?.access_token || !data.user?.email) return null

  const cookieStore = await cookies()
  cookieStore.set(ACCESS_COOKIE, data.session.access_token, sessionCookieOptions(data.session.expires_in ?? 3600))
  cookieStore.set(REFRESH_COOKIE, data.session.refresh_token, sessionCookieOptions(WEEK))

  const user = await getAppUser(data.user.id, data.user.email)
  return user.isActive ? user : null
}

export async function getSession(): Promise<AppUser | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(ACCESS_COOKIE)?.value
  const refreshToken = cookieStore.get(REFRESH_COOKIE)?.value

  if (!token) {
    return refreshToken ? refreshSession(refreshToken) : null
  }

  const supabase = createPasswordAuthClient()
  const { data, error } = await supabase.auth.getUser(token)

  if (error || !data.user?.email) {
    return refreshToken ? refreshSession(refreshToken) : null
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

export function authCookieHeaders(accessToken: string, refreshToken: string, expiresIn?: number) {
  const headers = new Headers()
  for (const value of authCookieHeaderValues(accessToken, refreshToken, expiresIn)) {
    headers.append('Set-Cookie', value)
  }
  return headers
}

export function authCookieHeaderValues(accessToken: string, refreshToken: string, expiresIn?: number) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return [
    `${ACCESS_COOKIE}=${accessToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${expiresIn ?? 3600}${secure}`,
    `${REFRESH_COOKIE}=${refreshToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${WEEK}${secure}`,
  ]
}

export function clearAuthCookieHeaders() {
  const headers = new Headers()
  for (const value of clearAuthCookieHeaderValues()) {
    headers.append('Set-Cookie', value)
  }
  return headers
}

export function clearAuthCookieHeaderValues() {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return [
    `${ACCESS_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
    `${REFRESH_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
  ]
}
