import { runReadinessCheck, runDiagnostics } from '@/lib/ops/health'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const diagnostics = searchParams.get('diagnostics') === 'true'

  const result = await runReadinessCheck()
  const body = diagnostics
    ? { ...result, diagnostics: runDiagnostics() }
    : result

  return Response.json(body, { status: result.status === 'fail' ? 503 : 200 })
}
