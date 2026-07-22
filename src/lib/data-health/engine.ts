import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCompanyId } from '@/lib/tenant'
import { resolveApplicableModules } from '@/lib/go-live/modules/profile'
import { DATA_HEALTH_ENGINE_VERSION } from '@/lib/go-live/constants'
import { HEALTH_CHECKS } from './checks'
import type {
  HealthCategoryScore,
  HealthFinding,
  HealthReport,
  HealthSeverity,
} from './types'

const SEVERITY_PENALTY: Record<HealthSeverity, number> = {
  critical: 25,
  high: 12,
  medium: 5,
  low: 2,
  informational: 0,
}

function emptySummary(): Record<HealthSeverity, number> {
  return { critical: 0, high: 0, medium: 0, low: 0, informational: 0 }
}

export async function runDataHealthScan(input?: {
  companyId?: string
  scanId?: string
  createdBy?: string
}): Promise<{ scanId: string; report: HealthReport }> {
  const cid = input?.companyId ?? (await resolveCompanyId())
  const db = createAdminClient()

  const { data: company } = await db
    .from('companies')
    .select('readiness_modules')
    .eq('id', cid)
    .maybeSingle()
  const { data: zatcaSettings } = await db
    .from('company_zatca_settings')
    .select('zatca_enabled')
    .eq('company_id', cid)
    .maybeSingle()

  const applicableModules = resolveApplicableModules(
    (company?.readiness_modules as Record<string, unknown>) ?? {},
    Boolean(zatcaSettings?.zatca_enabled),
  )

  let scanId = input?.scanId
  if (!scanId) {
    const { data, error } = await db
      .from('data_health_scans')
      .insert({
        company_id: cid,
        created_by: input?.createdBy ?? null,
        status: 'RUNNING',
        engine_version: DATA_HEALTH_ENGINE_VERSION,
        progress_json: { phase: 'scanning', percent: 10 },
      })
      .select('id')
      .single()
    if (error) throw error
    scanId = String(data.id)
  } else {
    await db
      .from('data_health_scans')
      .update({ status: 'RUNNING', progress_json: { phase: 'scanning', percent: 10 } })
      .eq('id', scanId)
      .eq('company_id', cid)
  }

  const findings: HealthFinding[] = []
  const checksExecuted: string[] = []
  const ctx = { companyId: cid, applicableModules, db }

  for (const check of HEALTH_CHECKS) {
    if (check.moduleKey && !applicableModules.includes(check.moduleKey)) continue
    checksExecuted.push(check.id)
    try {
      const found = await check.detect(ctx)
      findings.push(...found)
    } catch {
      findings.push({
        checkId: check.id,
        severity: 'informational',
        entityType: 'system',
        title: `Check ${check.id} skipped`,
        detail: 'Check failed to run; see server logs.',
        recommendation: 'Re-run scan after verifying database access.',
      })
    }
  }

  const summary = emptySummary()
  for (const f of findings) summary[f.severity] += 1

  const byCategory = new Map<string, HealthFinding[]>()
  for (const f of findings) {
    const check = HEALTH_CHECKS.find((c) => c.id === f.checkId)
    const cat = check?.category ?? 'other'
    const list = byCategory.get(cat) ?? []
    list.push(f)
    byCategory.set(cat, list)
  }

  const categoryScores: HealthCategoryScore[] = [...byCategory.entries()].map(
    ([category, list]) => {
      let penalty = 0
      const findingCounts: Partial<Record<HealthSeverity, number>> = {}
      for (const f of list) {
        findingCounts[f.severity] = (findingCounts[f.severity] ?? 0) + 1
        penalty += SEVERITY_PENALTY[f.severity]
      }
      return {
        category,
        score: Math.max(0, 100 - penalty),
        findingCounts,
      }
    },
  )

  // categories with no findings score 100 when checks ran for them
  const categoriesTouched = new Set(
    HEALTH_CHECKS.filter(
      (c) => !c.moduleKey || applicableModules.includes(c.moduleKey),
    ).map((c) => c.category),
  )
  for (const cat of categoriesTouched) {
    if (![...byCategory.keys()].includes(cat)) {
      categoryScores.push({ category: cat, score: 100, findingCounts: {} })
    }
  }

  const overallScore =
    categoryScores.length === 0
      ? 100
      : Math.round(
          categoryScores.reduce((s, c) => s + c.score, 0) / categoryScores.length,
        )

  const report: HealthReport = {
    scanId: scanId!,
    engineVersion: DATA_HEALTH_ENGINE_VERSION,
    overallScore,
    categoryScores,
    findings: findings.slice(0, 200),
    summary,
    checksExecuted,
    scannedAt: new Date().toISOString(),
  }

  await db
    .from('data_health_scans')
    .update({
      status: 'COMPLETED',
      result_json: report,
      progress_json: { phase: 'done', percent: 100 },
    })
    .eq('id', scanId)
    .eq('company_id', cid)

  await db.from('data_health_score_history').insert({
    company_id: cid,
    scan_id: scanId,
    score: overallScore,
    severity_counts: summary,
    category_snapshot: categoryScores,
  })

  return { scanId: scanId!, report }
}

export async function getLatestHealthScore(companyId?: string) {
  const cid = companyId ?? (await resolveCompanyId())
  const db = createAdminClient()
  const { data } = await db
    .from('data_health_score_history')
    .select('score, severity_counts, recorded_at')
    .eq('company_id', cid)
    .order('recorded_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data
}

export async function listHealthHistory(companyId?: string, limit = 30) {
  const cid = companyId ?? (await resolveCompanyId())
  const db = createAdminClient()
  const { data, error } = await db
    .from('data_health_score_history')
    .select('id, score, severity_counts, recorded_at, scan_id')
    .eq('company_id', cid)
    .order('recorded_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data ?? []
}
