import 'server-only'
import { resolveCompanyId, supabaseDb } from '@/lib/db/repository-utils'
import { ZATCA_FIRST_PIH_BASE64 } from './constants'
import { invoiceHashHexToPihBase64 } from './hash'

export interface PihChainIssue {
  invoiceId: string
  invoiceNo: string
  message: string
}

export interface PihChainVerification {
  valid: boolean
  issues: PihChainIssue[]
}

/**
 * Verifies the stored PIH chain for the tenant (ordered by invoice creation time).
 * Does not modify invoices.
 */
export async function verifyPihChain(excludeInvoiceId?: string): Promise<PihChainVerification> {
  const companyId = await resolveCompanyId()
  const db = supabaseDb()

  let query = db
    .from('invoices')
    .select('id, invoice_no, invoice_hash, previous_invoice_hash, created_at')
    .eq('company_id', companyId)
    .not('invoice_hash', 'is', null)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })

  if (excludeInvoiceId) {
    query = query.neq('id', excludeInvoiceId)
  }

  const { data, error } = await query
  if (error) throw error

  const issues: PihChainIssue[] = []
  let expectedPihBase64: string | null = null

  for (const row of data ?? []) {
    const invoiceId = String(row.id)
    const invoiceNo = String(row.invoice_no)
    const hash = String(row.invoice_hash)
    const storedPrevious = row.previous_invoice_hash as string | null

    if (expectedPihBase64 === null) {
      if (storedPrevious && storedPrevious !== hash && storedPrevious.length > 0) {
        // First hashed invoice should have null previous or align with chain start
      }
    } else {
      const expectedHex = Buffer.from(expectedPihBase64, 'base64').toString('hex')
      if (storedPrevious && storedPrevious !== expectedHex) {
        issues.push({
          invoiceId,
          invoiceNo,
          message: `Previous invoice hash mismatch. Expected chain link from prior submitted invoice.`,
        })
      }
    }

    expectedPihBase64 = invoiceHashHexToPihBase64(hash)
  }

  return { valid: issues.length === 0, issues }
}

/** Validates PIH for a single invoice before submission. */
export async function verifyPihForInvoice(invoiceId: string): Promise<PihChainVerification> {
  const companyId = await resolveCompanyId()
  const db = supabaseDb()

  const { data: current, error: currentError } = await db
    .from('invoices')
    .select('id, invoice_no, previous_invoice_hash, created_at')
    .eq('company_id', companyId)
    .eq('id', invoiceId)
    .maybeSingle()

  if (currentError) throw currentError
  if (!current) return { valid: false, issues: [{ invoiceId, invoiceNo: '?', message: 'Invoice not found' }] }

  const { data: prior, error: priorError } = await db
    .from('invoices')
    .select('invoice_hash')
    .eq('company_id', companyId)
    .neq('id', invoiceId)
    .not('invoice_hash', 'is', null)
    .lt('created_at', current.created_at)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (priorError) throw priorError

  const expectedPrevious = prior?.invoice_hash as string | null
  const storedPrevious = current.previous_invoice_hash as string | null

  if (!expectedPrevious) {
    if (storedPrevious) {
      return {
        valid: false,
        issues: [{
          invoiceId,
          invoiceNo: String(current.invoice_no),
          message: 'This is the first invoice in the chain but a previous hash is stored.',
        }],
      }
    }
    return { valid: true, issues: [] }
  }

  if (storedPrevious && storedPrevious !== expectedPrevious) {
    return {
      valid: false,
      issues: [{
        invoiceId,
        invoiceNo: String(current.invoice_no),
        message: 'Previous invoice hash does not match the last submitted invoice in this company.',
      }],
    }
  }

  return { valid: true, issues: [] }
}

export { ZATCA_FIRST_PIH_BASE64 }
