/** Runs once per Node server instance — bootstraps demo users on Vercel/production SQLite. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  try {
    const { prisma } = await import('@/lib/prisma')
    const { ensureDemoUsers } = await import('@/lib/demo-users')
    await ensureDemoUsers(prisma)
  } catch (error) {
    console.error('[hisab.ai] Database bootstrap failed:', error)
  }
}
