import { getSupabaseUrl } from '@/lib/supabase/env'
import { getMetricsSnapshot } from './metrics'

export interface HealthCheckResult {
  status: 'ok' | 'degraded' | 'fail'
  version: string
  uptimeSeconds: number
  checks: Record<string, { status: 'ok' | 'fail'; detail?: string }>
}

const startedAt = Date.now()

export async function runLivenessCheck(): Promise<HealthCheckResult> {
  return {
    status: 'ok',
    version: process.env.npm_package_version ?? '0.1.0',
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    checks: { process: { status: 'ok' } },
  }
}

export async function runReadinessCheck(): Promise<HealthCheckResult> {
  const checks: HealthCheckResult['checks'] = { process: { status: 'ok' } }
  let status: HealthCheckResult['status'] = 'ok'

  const required = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']
  for (const key of required) {
    if (!process.env[key]) {
      checks.env = { status: 'fail', detail: `Missing ${key}` }
      status = 'fail'
    }
  }

  if (!checks.env) {
    checks.env = { status: 'ok' }
  }

  try {
    const url = getSupabaseUrl()
    checks.supabase = url ? { status: 'ok' } : { status: 'fail', detail: 'Supabase URL unavailable' }
    if (!url) status = 'fail'
  } catch (error) {
    checks.supabase = { status: 'fail', detail: String(error) }
    status = 'fail'
  }

  return {
    status,
    version: process.env.npm_package_version ?? '0.1.0',
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    checks,
  }
}

export function runDiagnostics() {
  return {
    node: process.version,
    env: process.env.NODE_ENV ?? 'development',
    metrics: getMetricsSnapshot(),
    memory: process.memoryUsage(),
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
  }
}
