import 'server-only'
import { submitWorkflow, getWorkflowStatus, WorkflowError } from './engine'
import type { WorkflowEntityType } from './types'

export { WorkflowError }

/** Start workflow if a binding exists — no-op when none configured. */
export async function maybeStartWorkflow(input: {
  entityType: WorkflowEntityType
  entityId: string
  entityLabel?: string
  amount?: number
  departmentId?: string | null
  submittedById?: string | null
  companyId?: string
  metadata?: Record<string, unknown>
}) {
  try {
    return await submitWorkflow(input)
  } catch {
    return null
  }
}

export async function syncDocumentApprovalStatus(
  entityType: WorkflowEntityType,
  entityId: string,
  companyId: string,
) {
  const { getWorkflowStatus } = await import('./engine')
  const instance = await getWorkflowStatus(entityType, entityId, companyId)
  if (!instance) return null

  const statusMap: Record<string, string> = {
    APPROVED: 'APPROVED',
    REJECTED: 'REJECTED',
    IN_PROGRESS: 'PENDING',
    PENDING: 'PENDING',
  }

  const approvalStatus = statusMap[String(instance.status)] ?? 'PENDING'
  const tableMap: Partial<Record<WorkflowEntityType, string>> = {
    BILL: 'bills',
    EXPENSE: 'expenses',
    EXPENSE_CLAIM: 'expense_claims',
    PAYROLL: 'payroll_entries',
    JOURNAL_ENTRY: 'journal_entries',
    PURCHASE_ORDER: 'purchase_orders',
    INVOICE: 'invoices',
  }

  const table = tableMap[entityType]
  if (!table) return approvalStatus

  const { createAdminClient } = await import('@/lib/supabase/admin')
  const client = createAdminClient()
  const patch: Record<string, unknown> = {}
  if (table === 'bills' || table === 'purchase_orders') patch.approval_status = approvalStatus
  if (table === 'expenses' || table === 'expense_claims') patch.status = approvalStatus === 'APPROVED' ? 'APPROVED' : 'SUBMITTED'
  if (table === 'payroll_entries') patch.status = approvalStatus === 'APPROVED' ? 'APPROVED' : 'DRAFT'
  if (table === 'journal_entries') patch.status = approvalStatus === 'APPROVED' ? 'DRAFT' : 'DRAFT'

  if (Object.keys(patch).length > 0) {
    await client.from(table).update(patch).eq('id', entityId).eq('company_id', companyId)
  }

  return approvalStatus
}

export async function onWorkflowApproved(instance: Record<string, unknown>) {
  const entityType = String(instance.entity_type)
  const entityId = String(instance.entity_id)
  const companyId = String(instance.company_id)

  await syncDocumentApprovalStatus(entityType as WorkflowEntityType, entityId, companyId)

  if (entityType === 'BILL') {
    const { postBillToLedger } = await import('@/lib/accounting/document-posting')
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const client = createAdminClient()
    await client.from('bills').update({ status: 'RECEIVED', approval_status: 'APPROVED' }).eq('id', entityId)
    await postBillToLedger(entityId, companyId)
  } else if (entityType === 'INVOICE') {
    const { postInvoiceToLedger } = await import('@/lib/accounting/document-posting')
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const client = createAdminClient()
    await client.from('invoices').update({ status: 'SENT' }).eq('id', entityId)
    await postInvoiceToLedger(entityId, companyId)
  } else if (entityType === 'EXPENSE') {
    const { postExpenseToLedger } = await import('@/lib/accounting/document-posting')
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const client = createAdminClient()
    await client.from('expenses').update({ status: 'APPROVED' }).eq('id', entityId)
    await postExpenseToLedger(entityId, companyId)
  } else if (entityType === 'PAYROLL') {
    const { postPayrollToLedger } = await import('@/lib/accounting/document-posting')
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const client = createAdminClient()
    await client.from('payroll_entries').update({ status: 'APPROVED' }).eq('id', entityId)
    await postPayrollToLedger(entityId, companyId)
  } else if (entityType === 'JOURNAL_ENTRY') {
    const { postJournalEntry } = await import('@/lib/accounting/posting-service')
    await postJournalEntry(entityId, { companyId })
  }
}

/** Throws when a workflow instance exists but is not yet approved. */
export async function requireApprovedWorkflow(
  entityType: WorkflowEntityType,
  entityId: string,
  companyId: string,
) {
  const instance = await getWorkflowStatus(entityType, entityId, companyId)
  if (!instance) return
  if (String(instance.status) !== 'APPROVED') {
    throw new WorkflowError('Document requires workflow approval before proceeding', 'WORKFLOW_PENDING')
  }
}
