import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCompanyId } from '@/lib/tenant'
import type { GoLiveSessionStatus, PreviewPlan, ReadinessAnalysis } from './types'
import { DETECTION_ENGINE_VERSION, WIZARD_VERSION } from './constants'

export interface GoLiveSessionRow {
  id: string
  companyId: string
  status: GoLiveSessionStatus
  wizardVersion: string
  detectionEngineVersion: string
  analysis: ReadinessAnalysis | null
  selection: unknown
  preview: PreviewPlan | null
  result: unknown
  progress: Record<string, unknown>
  error: unknown
}

function mapSession(row: Record<string, unknown>): GoLiveSessionRow {
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    status: row.status as GoLiveSessionStatus,
    wizardVersion: String(row.wizard_version ?? WIZARD_VERSION),
    detectionEngineVersion: String(row.detection_engine_version ?? DETECTION_ENGINE_VERSION),
    analysis: (row.analysis_json as ReadinessAnalysis) ?? null,
    selection: row.selection_json ?? null,
    preview: (row.preview_json as PreviewPlan) ?? null,
    result: row.result_json ?? null,
    progress: (row.progress_json as Record<string, unknown>) ?? {},
    error: row.error_json ?? null,
  }
}

export async function createGoLiveSession(createdBy: string, companyId?: string) {
  const cid = companyId ?? (await resolveCompanyId())
  const db = createAdminClient()
  const { data, error } = await db
    .from('go_live_sessions')
    .insert({
      company_id: cid,
      created_by: createdBy,
      status: 'PENDING',
      wizard_version: WIZARD_VERSION,
      detection_engine_version: DETECTION_ENGINE_VERSION,
      progress_json: { phase: 'starting', percent: 0 },
    })
    .select('*')
    .single()
  if (error) throw error
  return mapSession(data as Record<string, unknown>)
}

export async function getGoLiveSession(sessionId: string, companyId?: string) {
  const cid = companyId ?? (await resolveCompanyId())
  const db = createAdminClient()
  const { data, error } = await db
    .from('go_live_sessions')
    .select('*')
    .eq('id', sessionId)
    .eq('company_id', cid)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return mapSession(data as Record<string, unknown>)
}

export async function updateGoLiveSession(
  sessionId: string,
  patch: Record<string, unknown>,
  companyId?: string,
) {
  const cid = companyId ?? (await resolveCompanyId())
  const db = createAdminClient()
  const { data, error } = await db
    .from('go_live_sessions')
    .update(patch)
    .eq('id', sessionId)
    .eq('company_id', cid)
    .select('*')
    .single()
  if (error) throw error
  return mapSession(data as Record<string, unknown>)
}

export async function appendReadinessHistory(input: {
  companyId: string
  sessionId: string
  score: number
  verdict: string
  blockedCount: number
  checklist: unknown
}) {
  const db = createAdminClient()
  await db.from('readiness_score_history').insert({
    company_id: input.companyId,
    session_id: input.sessionId,
    score: input.score,
    verdict: input.verdict,
    blocked_count: input.blockedCount,
    checklist_snapshot: input.checklist,
  })
}

export async function listReadinessHistory(companyId?: string, limit = 30) {
  const cid = companyId ?? (await resolveCompanyId())
  const db = createAdminClient()
  const { data, error } = await db
    .from('readiness_score_history')
    .select('id, score, verdict, blocked_count, recorded_at')
    .eq('company_id', cid)
    .order('recorded_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data ?? []
}
