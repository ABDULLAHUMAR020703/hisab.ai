import { createCompany } from '@/lib/db/company.repository'
import { createClient } from '@/lib/supabase/server'
import { createPasswordAuthClient, upsertProfileAndMembership } from '@/lib/supabase/auth-users'

function slugifyCompanyName(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48)
  return base || 'company'
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const password = typeof body.password === 'string' ? body.password : ''
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const companyName = typeof body.companyName === 'string' ? body.companyName.trim() : ''

    if (!email || !password || !name || !companyName) {
      return Response.json(
        { error: 'Name, company name, email, and password are required' },
        { status: 400 },
      )
    }

    if (password.length < 8) {
      return Response.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
    }

    const supabase = createPasswordAuthClient()
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: name,
          company_name: companyName,
        },
      },
    })

    if (error) {
      return Response.json({ error: error.message }, { status: 400 })
    }

    if (!data.user) {
      return Response.json({ error: 'Registration failed' }, { status: 500 })
    }

    const company = await createCompany({
      slug: `${slugifyCompanyName(companyName)}-${Date.now().toString(36)}`,
      companyName,
      country: 'Saudi Arabia',
      currency: 'SAR',
    })

    await upsertProfileAndMembership({
      userId: data.user.id,
      email,
      name,
      role: 'OWNER',
      companyId: company.id,
      isActive: true,
    })

    if (data.session) {
      const serverSupabase = await createClient()
      await serverSupabase.auth.setSession({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      })
    }

    return Response.json({
      success: true,
      requiresEmailVerification: !data.session,
      user: {
        id: data.user.id,
        email,
        companyId: company.id,
      },
    }, { status: 201 })
  } catch (error) {
    console.error('[auth] registration failed:', error)
    return Response.json({ error: 'Registration failed' }, { status: 500 })
  }
}
