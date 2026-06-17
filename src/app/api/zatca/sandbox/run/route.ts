import { requireAuth } from '@/lib/auth'
import { runAllSandboxScenarios } from '@/lib/zatca/testing/sandbox-runner'

/**
 * POST /api/zatca/sandbox/run
 * Runs all sandbox E2E test scenarios (mock mode).
 */
export async function POST() {
  try {
    await requireAuth()
    const results = await runAllSandboxScenarios()
    const passed = results.filter((r) => r.passed).length
    return Response.json({
      summary: { total: results.length, passed, failed: results.length - passed },
      results,
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return Response.json({ error: String(error) }, { status: 500 })
  }
}
