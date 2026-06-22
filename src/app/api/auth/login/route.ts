import { authCookieHeaderValues } from '@/lib/auth'
import { createPasswordAuthClient, ensureDemoSupabaseUsers, getAppUser } from '@/lib/supabase/auth-users'

export async function POST(request: Request) {
  try {
    const { email, password } = await request.json()

    if (!email || !password) {
      return Response.json({ error: 'Email and password are required' }, { status: 400 })
    }

    await ensureDemoSupabaseUsers()

    const supabase = createPasswordAuthClient()
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })

    if (error || !data.session || !data.user?.email) {
      return Response.json({ error: 'Invalid email or password' }, { status: 401 })
    }

    const user = await getAppUser(data.user.id, data.user.email)
    if (!user.isActive) {
      return Response.json({ error: 'Account is disabled' }, { status: 403 })
    }

    const response = Response.json({
      success: true,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    })

    const headers = new Headers(response.headers)
    for (const value of authCookieHeaderValues(
      data.session.access_token,
      data.session.refresh_token,
      data.session.expires_in,
    )) {
      headers.append('Set-Cookie', value)
    }

    return new Response(response.body, { status: 200, headers })
  } catch (error) {
    console.error('Login error:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return Response.json({ error: message }, { status: 500 })
  }
}
