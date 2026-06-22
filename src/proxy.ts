import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const sessionToken = request.cookies.get('session')?.value

  const isAuthRoute = pathname.startsWith('/login')
  const isApiAuth = pathname.startsWith('/api/auth')
  const isApiSeed = pathname.startsWith('/api/seed')
  const isApiRoute = pathname.startsWith('/api/')
  const isPublic = isAuthRoute || isApiAuth || isApiSeed

  if (!isPublic && !sessionToken) {
    if (isApiRoute) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const loginUrl = new URL('/login', request.url)
    return NextResponse.redirect(loginUrl)
  }

  if (isAuthRoute && sessionToken) {
    const dashboardUrl = new URL('/', request.url)
    return NextResponse.redirect(dashboardUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|public).*)'],
}
