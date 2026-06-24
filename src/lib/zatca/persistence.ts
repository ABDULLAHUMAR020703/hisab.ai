import 'server-only'
import type { InvoiceType } from '@/lib/db/prisma-types'
import { getInvoiceRepository } from '@/lib/db/provider'
import { queryByIdOrLegacy, resolveCompanyId, supabaseDb } from '@/lib/db/repository-utils'
import type { InvoiceRecord } from '@/lib/db/entities'
import { prisma } from '@/lib/prisma'
import { isSupabaseEnabled } from '@/lib/supabase/env'

export async function loadInvoiceForZatca(invoiceId: string): Promise<InvoiceRecord | null> {
  if (isSupabaseEnabled()) {
    return getInvoiceRepository().findById(invoiceId)
  }

  return prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      customer: true,
      lines: true,
      payments: true,
      createdBy: { select: { name: true } },
    },
  }) as Promise<InvoiceRecord | null>
}

export async function countHashedInvoices(excludeInvoiceId?: string): Promise<number> {
  if (!isSupabaseEnabled()) {
    return prisma.invoice.count({
      where: {
        invoiceHash: { not: null },
        ...(excludeInvoiceId ? { id: { not: excludeInvoiceId } } : {}),
      },
    })
  }

  const db = supabaseDb()
  const companyId = await resolveCompanyId()
  let query = db
    .from('invoices')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .not('invoice_hash', 'is', null)
    .is('deleted_at', null)

  if (excludeInvoiceId) {
    const current = await queryByIdOrLegacy(db, 'invoices', excludeInvoiceId, companyId)
    if (current?.id) query = query.neq('id', current.id)
  }

  const { count, error } = await query
  if (error) throw error
  return count ?? 0
}

export async function getPriorInvoiceHash(invoiceId: string): Promise<string | null> {
  if (!isSupabaseEnabled()) {
    const current = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: { id: true, createdAt: true },
    })

    if (!current) return null

    const previous = await prisma.invoice.findFirst({
      where: {
        id: { not: invoiceId },
        invoiceHash: { not: null },
        createdAt: { lt: current.createdAt },
      },
      orderBy: { createdAt: 'desc' },
      select: { invoiceHash: true },
    })

    return previous?.invoiceHash ?? null
  }

  const db = supabaseDb()
  const companyId = await resolveCompanyId()
  const current = await queryByIdOrLegacy(db, 'invoices', invoiceId, companyId)
  if (!current) return null

  const { data, error } = await db
    .from('invoices')
    .select('invoice_hash')
    .eq('company_id', companyId)
    .neq('id', current.id)
    .not('invoice_hash', 'is', null)
    .lt('created_at', current.created_at)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return (data?.invoice_hash as string | null) ?? null
}

export async function updateInvoiceZatcaFields(
  invoiceId: string,
  fields: Record<string, unknown>,
): Promise<void> {
  if (!isSupabaseEnabled()) {
    await prisma.invoice.update({
      where: { id: invoiceId },
      data: fields,
    })
    return
  }

  const db = supabaseDb()
  const companyId = await resolveCompanyId()
  const invoice = await queryByIdOrLegacy(db, 'invoices', invoiceId, companyId)
  if (!invoice) throw new Error('Invoice not found')

  const patch: Record<string, unknown> = {}
  if (fields.invoiceHash !== undefined) patch.invoice_hash = fields.invoiceHash
  if (fields.previousInvoiceHash !== undefined) patch.previous_invoice_hash = fields.previousInvoiceHash
  if (fields.zatcaStatus !== undefined) patch.zatca_status = fields.zatcaStatus
  if (fields.zatcaFailureCode !== undefined) patch.zatca_failure_code = fields.zatcaFailureCode
  if (fields.zatcaResponseMessage !== undefined) patch.zatca_response_message = fields.zatcaResponseMessage
  if (fields.zatcaRequestId !== undefined) patch.zatca_request_id = fields.zatcaRequestId
  if (fields.zatcaGlobalTransactionId !== undefined) {
    patch.zatca_global_transaction_id = fields.zatcaGlobalTransactionId
  }
  if (fields.zatcaResponseCode !== undefined) patch.zatca_response_code = fields.zatcaResponseCode
  if (fields.zatcaWarningCount !== undefined) patch.zatca_warning_count = fields.zatcaWarningCount
  if (fields.zatcaErrorCount !== undefined) patch.zatca_error_count = fields.zatcaErrorCount
  if (fields.clearanceStatus !== undefined) patch.clearance_status = fields.clearanceStatus
  if (fields.clearedInvoicePayload !== undefined) patch.cleared_invoice_payload = fields.clearedInvoicePayload
  if (fields.signedXml !== undefined) patch.signed_xml = fields.signedXml
  if (fields.zatcaResponsePayload !== undefined) patch.zatca_response_payload = fields.zatcaResponsePayload
  if (fields.zatcaSubmissionDate !== undefined) patch.zatca_submission_date = fields.zatcaSubmissionDate

  const { error } = await db
    .from('invoices')
    .update(patch)
    .eq('id', invoice.id)
    .eq('company_id', companyId)

  if (error && patch.zatca_global_transaction_id !== undefined && /zatca_global_transaction_id/i.test(error.message)) {
    const legacyPatch = { ...patch }
    delete legacyPatch.zatca_global_transaction_id
    const retry = await db
      .from('invoices')
      .update(legacyPatch)
      .eq('id', invoice.id)
      .eq('company_id', companyId)
    if (retry.error) throw retry.error
    return
  }

  if (error && (patch.zatca_warning_count !== undefined || patch.zatca_error_count !== undefined)) {
    const legacyPatch = { ...patch }
    delete legacyPatch.zatca_warning_count
    delete legacyPatch.zatca_error_count
    const retry = await db
      .from('invoices')
      .update(legacyPatch)
      .eq('id', invoice.id)
      .eq('company_id', companyId)
    if (!retry.error) return
  }

  if (error) throw error
}

export async function syncInvoiceClassification(
  invoiceId: string,
  invoiceType: InvoiceType,
): Promise<void> {
  if (!isSupabaseEnabled()) {
    await prisma.invoice.update({
      where: { id: invoiceId },
      data: { invoiceType },
    })
    return
  }

  const db = supabaseDb()
  const companyId = await resolveCompanyId()
  const invoice = await queryByIdOrLegacy(db, 'invoices', invoiceId, companyId)
  if (!invoice) throw new Error('Invoice not found')

  const { error } = await db
    .from('invoices')
    .update({ invoice_type: invoiceType })
    .eq('id', invoice.id)
    .eq('company_id', companyId)

  if (error) throw error
}
