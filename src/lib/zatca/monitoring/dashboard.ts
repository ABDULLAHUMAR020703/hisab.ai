import 'server-only'
import type { ZatcaInvoiceStatus } from '@/lib/db/prisma-types'
import { getSettingsRepository } from '@/lib/db/provider'
import { resolveCompanyId, supabaseDb } from '@/lib/db/repository-utils'
import { getCertificateStatus } from '../onboarding/certificate-status'

export interface ZatcaDashboardStats {
  submitted: number
  cleared: number
  reported: number
  failed: number
  pending: number
  retrying: number
  successRate: number
  lastSubmissionAt: string | null
  lastSuccessAt: string | null
}

export interface ZatcaRecentActivity {
  id: string
  invoiceNo: string
  invoiceType: string
  zatcaStatus: ZatcaInvoiceStatus
  requestId: string | null
  globalTransactionId: string | null
  submissionRoute: string | null
  submittedAt: string | null
  responseMessage: string | null
}

export interface ZatcaOperationalSummary {
  certificateStatus: Awaited<ReturnType<typeof getCertificateStatus>>
  topErrorCodes: Array<{ code: string; count: number }>
  recentRequestIds: Array<{ invoiceNo: string; requestId: string; status: ZatcaInvoiceStatus }>
  recentFailures: ZatcaRecentActivity[]
  environment: string
  connected: boolean
  compliancePassed: boolean
  productionCsidIssued: boolean
}

async function countByZatcaStatus(status: string) {
  const db = supabaseDb()
  const companyId = await resolveCompanyId()
  const { count, error } = await db
    .from('invoices')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .eq('zatca_status', status)
    .is('deleted_at', null)
  if (error) throw error
  return count ?? 0
}

export async function getZatcaDashboardStats(): Promise<ZatcaDashboardStats> {
  const db = supabaseDb()
  const companyId = await resolveCompanyId()

  const [cleared, reported, failed, pending, submittedRows] = await Promise.all([
    countByZatcaStatus('CLEARED'),
    countByZatcaStatus('REPORTED'),
    countByZatcaStatus('FAILED'),
    countByZatcaStatus('PENDING'),
    db.from('invoices')
      .select('zatca_status, zatca_submission_date')
      .eq('company_id', companyId)
      .neq('zatca_status', 'DRAFT')
      .is('deleted_at', null)
      .order('zatca_submission_date', { ascending: false })
      .limit(100),
  ])

  if (submittedRows.error) throw submittedRows.error
  const rows = submittedRows.data ?? []
  const submitted = rows.length
  const successes = rows.filter((r) => ['CLEARED', 'REPORTED', 'SUBMITTED'].includes(String(r.zatca_status))).length
  const successRate = submitted > 0 ? Math.round((successes / submitted) * 100) : 0
  const lastSubmissionAt = rows[0]?.zatca_submission_date ? String(rows[0].zatca_submission_date) : null
  const lastSuccessRow = rows.find((r) => ['CLEARED', 'REPORTED'].includes(String(r.zatca_status)))
  const lastSuccessAt = lastSuccessRow?.zatca_submission_date ? String(lastSuccessRow.zatca_submission_date) : null

  return { submitted, cleared, reported, failed, pending, retrying: 0, successRate, lastSubmissionAt, lastSuccessAt }
}

export async function getZatcaRecentActivity(limit = 20): Promise<ZatcaRecentActivity[]> {
  const db = supabaseDb()
  const companyId = await resolveCompanyId()
  const { data, error } = await db
    .from('invoices')
    .select('id, invoice_no, invoice_type, zatca_status, zatca_request_id, zatca_global_transaction_id, zatca_submission_date, zatca_response_message, clearance_status')
    .eq('company_id', companyId)
    .neq('zatca_status', 'DRAFT')
    .is('deleted_at', null)
    .order('zatca_submission_date', { ascending: false, nullsFirst: false })
    .limit(limit)

  if (error) throw error

  return (data ?? []).map((inv) => ({
    id: String(inv.id),
    invoiceNo: String(inv.invoice_no),
    invoiceType: String(inv.invoice_type),
    zatcaStatus: String(inv.zatca_status) as ZatcaInvoiceStatus,
    requestId: (inv.zatca_request_id as string | null) ?? null,
    globalTransactionId: (inv.zatca_global_transaction_id as string | null) ?? null,
    submissionRoute: inv.zatca_status === 'CLEARED' ? 'clearance' : inv.zatca_status === 'REPORTED' ? 'reporting' : null,
    submittedAt: inv.zatca_submission_date ? String(inv.zatca_submission_date) : null,
    responseMessage: (inv.zatca_response_message as string | null) ?? null,
  }))
}

export async function getZatcaOperationalSummary(): Promise<ZatcaOperationalSummary> {
  const settings = await getSettingsRepository().findFirst()
  const environment = settings?.zatcaEnvironment ?? 'SANDBOX'
  const db = supabaseDb()
  const companyId = await resolveCompanyId()

  const [certificateStatus, invoicesRes, complianceRes, productionRes] = await Promise.all([
    getCertificateStatus(environment),
    db.from('invoices')
      .select('invoice_no, zatca_status, zatca_request_id, zatca_failure_code, zatca_submission_date, zatca_response_message, invoice_type')
      .eq('company_id', companyId)
      .neq('zatca_status', 'DRAFT')
      .is('deleted_at', null)
      .order('updated_at', { ascending: false })
      .limit(100),
    db.from('zatca_audit_logs')
      .select('id')
      .eq('company_id', companyId)
      .eq('action', 'COMPLIANCE_CHECKS_COMPLETED')
      .eq('result', 'SUCCESS')
      .limit(1),
    db.from('zatca_audit_logs')
      .select('id')
      .eq('company_id', companyId)
      .eq('action', 'PRODUCTION_CSID_ISSUED')
      .eq('result', 'SUCCESS')
      .limit(1),
  ])

  if (invoicesRes.error) throw invoicesRes.error
  const invoices = invoicesRes.data ?? []

  const errorCounts = new Map<string, number>()
  for (const invoice of invoices) {
    const code = invoice.zatca_failure_code as string | null
    if (code) errorCounts.set(code, (errorCounts.get(code) ?? 0) + 1)
  }

  const recentFailures = invoices
    .filter((invoice) => String(invoice.zatca_status) === 'FAILED')
    .slice(0, 10)
    .map((invoice) => ({
      id: String(invoice.invoice_no),
      invoiceNo: String(invoice.invoice_no),
      invoiceType: String(invoice.invoice_type),
      zatcaStatus: 'FAILED' as ZatcaInvoiceStatus,
      requestId: (invoice.zatca_request_id as string | null) ?? null,
      globalTransactionId: null,
      submissionRoute: null,
      submittedAt: invoice.zatca_submission_date ? String(invoice.zatca_submission_date) : null,
      responseMessage: (invoice.zatca_response_message as string | null) ?? null,
    }))

  return {
    certificateStatus,
    topErrorCodes: [...errorCounts.entries()]
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5),
    recentRequestIds: invoices
      .filter((invoice) => Boolean(invoice.zatca_request_id))
      .slice(0, 10)
      .map((invoice) => ({
        invoiceNo: String(invoice.invoice_no),
        requestId: String(invoice.zatca_request_id),
        status: String(invoice.zatca_status) as ZatcaInvoiceStatus,
      })),
    recentFailures,
    environment,
    connected: Boolean(
      settings?.zatcaEnabled
      && (certificateStatus.compliance.status !== 'MISSING' || certificateStatus.production.status !== 'MISSING'),
    ),
    compliancePassed: (complianceRes.data?.length ?? 0) > 0,
    productionCsidIssued: (productionRes.data?.length ?? 0) > 0,
  }
}
