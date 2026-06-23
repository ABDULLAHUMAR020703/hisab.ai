import { ensureDemoSupabaseUsers } from '@/lib/supabase/auth-users'

export async function POST() {
  try {
    await ensureDemoSupabaseUsers()

    return Response.json({
      success: true,
      message: 'Supabase is configured. Demo users are available; business data is stored in Supabase.',
      qa: { status: 'supabase-ready', customers: 0, inventory: 0, invoices: 0, vendors: 0 },
    })
  } catch (error) {
    console.error('Seed error:', error)
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
