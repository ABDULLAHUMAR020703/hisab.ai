import { createCompany, uniqueCompanySlug } from '@/lib/db/company.repository'
import { createClient } from '@/lib/supabase/server'
import {
  createPasswordAuthClient,
  upsertProfileAndMembership,
  userHasCompanyMembership,
} from '@/lib/supabase/auth-users'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const password = typeof body.password === 'string' ? body.password : ''
    const confirmPassword = typeof body.confirmPassword === 'string' ? body.confirmPassword : ''
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const companyName = typeof body.companyName === 'string' ? body.companyName.trim() : ''

    if (!email || !password || !confirmPassword || !name || !companyName) {
      return Response.json(
        { error: 'Company name, full name, email, password, and confirm password are required' },
        { status: 400 },
      )
    }

    if (password.length < 8) {
      return Response.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
    }

    if (confirmPassword !== password) {
      return Response.json({ error: 'Passwords do not match' }, { status: 400 })
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

    if (await userHasCompanyMembership(data.user.id)) {
      return Response.json(
        { error: 'This account is already linked to a company. Sign in or ask your administrator for an invitation.' },
        { status: 409 },
      )
    }

    // Always create a new companies.id — company name is legal metadata, not a tenant key.
    const company = await createCompany({
      slug: uniqueCompanySlug(companyName),
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
