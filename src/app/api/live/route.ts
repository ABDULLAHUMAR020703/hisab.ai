import { runLivenessCheck } from '@/lib/ops/health'

export async function GET() {
  const result = await runLivenessCheck()
  return Response.json(result, { status: result.status === 'fail' ? 503 : 200 })
}
