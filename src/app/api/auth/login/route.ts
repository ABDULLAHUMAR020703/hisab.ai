import { prisma } from '@/lib/prisma'
import { ensureDemoUsers } from '@/lib/demo-users'
import bcrypt from 'bcryptjs'
import { randomBytes } from 'crypto'

function sessionCookie(token: string) {
  const maxAge = 7 * 24 * 60 * 60
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return `session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`
}

export async function POST(request: Request) {
  try {
    await ensureDemoUsers(prisma)

    const { email, password } = await request.json()

    if (!email || !password) {
      return Response.json({ error: 'Email and password are required' }, { status: 400 })
    }

    const user = await prisma.user.findUnique({ where: { email } })

    if (!user || !user.password) {
      return Response.json({ error: 'Invalid email or password' }, { status: 401 })
    }

    if (!user.isActive) {
      return Response.json({ error: 'Account is disabled' }, { status: 403 })
    }

    const valid = await bcrypt.compare(password, user.password)
    if (!valid) {
      return Response.json({ error: 'Invalid email or password' }, { status: 401 })
    }

    const token = randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

    await prisma.appSession.create({
      data: { userId: user.id, token, expiresAt },
    })

    const response = Response.json({
      success: true,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    })

    const headers = new Headers(response.headers)
    headers.set('Set-Cookie', sessionCookie(token))

    return new Response(response.body, { status: 200, headers })
  } catch (error) {
    console.error('Login error:', error)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
