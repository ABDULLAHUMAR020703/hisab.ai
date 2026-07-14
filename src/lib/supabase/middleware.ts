import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { getSupabaseAnonKey, getSupabaseUrl } from './env'
import { createCorrelationId, CORRELATION_HEADER } from '@/lib/ops/correlation'

const PUBLIC_PAGE_PREFIXES = [
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
  '/auth/callback',
]

const PUBLIC_API_PREFIXES = [
  '/api/auth',
  '/api/health',
  '/api/ready',
  '/api/live',
]

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PAGE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return true
  }
  return PUBLIC_API_PREFIXES.some((prefix) => pathname.startsWith(prefix))
}

function isAuthPage(pathname: string): boolean {
  return (
    pathname.startsWith('/login')
    || pathname.startsWith('/register')
    || pathname.startsWith('/forgot-password')
    || pathname.startsWith('/reset-password')
    || pathname.startsWith('/verify-email')
  )
}

/**
 * Refresh Supabase Auth session cookies and enforce authentication gate.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })
  const correlationId = request.headers.get(CORRELATION_HEADER) ?? createCorrelationId()

  const supabase = createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value)
        }
        supabaseResponse = NextResponse.next({ request })
        for (const { name, value, options } of cookiesToSet) {
          supabaseResponse.cookies.set(name, value, options)
        }
      },
    },
  })

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl
  const isPublic = isPublicPath(pathname)
  const isApiRoute = pathname.startsWith('/api/')

  if (!user && !isPublic) {
    if (isApiRoute) {
      const res = NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      res.headers.set(CORRELATION_HEADER, correlationId)
      return res
    }
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('next', pathname)
    const res = NextResponse.redirect(loginUrl)
    res.headers.set(CORRELATION_HEADER, correlationId)
    return res
  }

  if (user && isAuthPage(pathname)) {
    const res = NextResponse.redirect(new URL('/', request.url))
    res.headers.set(CORRELATION_HEADER, correlationId)
    return res
  }

  supabaseResponse.headers.set(CORRELATION_HEADER, correlationId)
  return supabaseResponse
}
