import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAudit } from '@/lib/audit/log'
import {
  DETECTION_ENGINE_VERSION,
  WIZARD_VERSION,
} from '../constants'
import type { GoLiveSelection, PreviewPlan, ReadinessAnalysis } from '../types'
import { getGoLiveSession, updateGoLiveSession } from '../session'

export async function executeGoLive(input: {
  companyId: string
  sessionId: string
  executedBy: string
  idempotencyKey: string
  selection: GoLiveSelection
  preview: PreviewPlan
  analysis: ReadinessAnalysis
}) {
  if (!input.preview.canExecute || input.analysis.blocked.length > 0) {
    const err = new Error('Cannot execute while Required items are Blocked')
    ;(err as Error & { status: number }).status = 409
    throw err
  }

  const session = await getGoLiveSession(input.sessionId, input.companyId)
  if (!session) {
    const err = new Error('Session not found')
    ;(err as Error & { status: number }).status = 404
    throw err
  }
  if (session.status === 'EXECUTED' || session.status === 'EXECUTED_WITH_WARNINGS') {
    return {
      idempotent: true,
      status: session.status,
      result: session.result,
    }
  }

  const result = {
    softDeletedInvoices: input.preview.softDelete.find((g) => g.entityType === 'invoice')?.ids ?? [],
    archivedCustomers: input.preview.archive.find((g) => g.entityType === 'customer')?.ids ?? [],
    archivedVendors: input.preview.archive.find((g) => g.entityType === 'vendor')?.ids ?? [],
    archivedProducts: input.preview.archive.find((g) => g.entityType === 'product')?.ids ?? [],
    archivedCostCenters: input.preview.archive.find((g) => g.entityType === 'cost_center')?.ids ?? [],
    numbering: input.selection.numbering ?? null,
    protectedKept: input.analysis.protectedSummary,
    wizardVersion: WIZARD_VERSION,
    detectionEngineVersion: DETECTION_ENGINE_VERSION,
    executedAt: new Date().toISOString(),
    executedBy: input.executedBy,
  }

  const db = createAdminClient()
  const { data, error } = await db.rpc('execute_go_live_actions', {
    p_company_id: input.companyId,
    p_session_id: input.sessionId,
    p_executed_by: input.executedBy,
    p_idempotency_key: input.idempotencyKey,
    p_soft_delete_invoice_ids: result.softDeletedInvoices,
    p_archive_customer_ids: result.archivedCustomers,
    p_archive_vendor_ids: result.archivedVendors,
    p_archive_product_ids: result.archivedProducts,
    p_archive_cost_center_ids: result.archivedCostCenters,
    p_numbering: input.selection.numbering ?? null,
    p_wizard_version: WIZARD_VERSION,
    p_detection_engine_version: DETECTION_ENGINE_VERSION,
    p_result: result,
  })

  if (error) throw error

  let status: 'EXECUTED' | 'EXECUTED_WITH_WARNINGS' = 'EXECUTED'
  try {
    await logAudit({
      action: 'GO_LIVE_EXECUTED',
      entityType: 'company',
      entityId: input.companyId,
      userId: input.executedBy,
      companyId: input.companyId,
      details: {
        sessionId: input.sessionId,
        wizardVersion: WIZARD_VERSION,
        detectionEngineVersion: DETECTION_ENGINE_VERSION,
        result,
        phraseConfirmed: true,
      },
    })
  } catch {
    status = 'EXECUTED_WITH_WARNINGS'
    await updateGoLiveSession(
      input.sessionId,
      { status: 'EXECUTED_WITH_WARNINGS' },
      input.companyId,
    )
  }

  await db.from('readiness_score_history').insert({
    company_id: input.companyId,
    session_id: input.sessionId,
    score: input.analysis.score,
    verdict: 'Ready',
    blocked_count: 0,
    checklist_snapshot: input.analysis.checklist,
  })

  return {
    idempotent: Boolean((data as { idempotent?: boolean })?.idempotent),
    status,
    result,
    rpc: data,
  }
}
