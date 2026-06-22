import { clearAuthCookieHeaderValues } from '@/lib/auth'

export async function POST() {
  const response = Response.json({ success: true })
  const headers = new Headers(response.headers)

  for (const value of clearAuthCookieHeaderValues()) {
    headers.append('Set-Cookie', value)
  }

  return new Response(response.body, { status: 200, headers })
}
