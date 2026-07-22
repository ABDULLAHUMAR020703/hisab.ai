import 'server-only'
import { resolveCompanyId, supabaseDb } from '@/lib/db/repository-utils'
import { extractTrailingSequenceNumber, formatDocumentNumber, previewDocumentNumber } from './format'
import {
  DOCUMENT_TYPE_DEFAULTS,
  DOCUMENT_TYPES,
  type DocumentSequenceRecord,
  type DocumentSequenceUpdateInput,
  type DocumentType,
} from './types'
import { validateDocumentSequenceUpdate } from './validation'

function mapRow(row: Record<string, unknown>): DocumentSequenceRecord {
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    documentType: String(row.document_type),
    prefix: String(row.prefix ?? ''),
    startingNumber: Number(row.starting_number ?? 1),
    nextNumber: Number(row.next_number ?? 1),
    padding: Number(row.padding ?? 6),
    suffix: String(row.suffix ?? ''),
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
  }
}

function isDocumentType(value: string): value is DocumentType {
  return (DOCUMENT_TYPES as readonly string[]).includes(value)
}

export async function ensureDocumentSequence(
  documentType: string,
  companyId?: string,
): Promise<DocumentSequenceRecord> {
  const db = supabaseDb()
  const cid = companyId ?? (await resolveCompanyId())
  const type = documentType.toUpperCase()
  const defaults = isDocumentType(type)
    ? DOCUMENT_TYPE_DEFAULTS[type]
    : { prefix: `${type.slice(0, 3)}-`, padding: 6, startingNumber: 1, label: type }

  const { data: existing } = await db
    .from('document_sequences')
    .select('*')
    .eq('company_id', cid)
    .eq('document_type', type)
    .maybeSingle()

  if (existing) return mapRow(existing as Record<string, unknown>)

  const { data: inserted, error: insertError } = await db
    .from('document_sequences')
    .upsert(
      {
        company_id: cid,
        document_type: type,
        prefix: defaults.prefix,
        starting_number: defaults.startingNumber,
        next_number: defaults.startingNumber,
        padding: defaults.padding,
        suffix: '',
      },
      { onConflict: 'company_id,document_type' },
    )
    .select('*')
    .single()

  if (!insertError && inserted) {
    return mapRow(inserted as Record<string, unknown>)
  }

  // Fallback RPC (e.g. race on concurrent insert)
  const { data, error } = await db.rpc('ensure_document_sequence', {
    p_company_id: cid,
    p_document_type: type,
    p_prefix: defaults.prefix,
    p_padding: defaults.padding,
    p_starting_number: defaults.startingNumber,
  })
  if (error) throw insertError ?? error

  const row = Array.isArray(data) ? data[0] : data
  if (row) return mapRow(row as Record<string, unknown>)

  const { data: fetched, error: fetchError } = await db
    .from('document_sequences')
    .select('*')
    .eq('company_id', cid)
    .eq('document_type', type)
    .single()
  if (fetchError) throw fetchError
  return mapRow(fetched as Record<string, unknown>)
}

export async function listDocumentSequences(
  companyId?: string,
): Promise<DocumentSequenceRecord[]> {
  const db = supabaseDb()
  const cid = companyId ?? (await resolveCompanyId())

  // Always ensure invoice sequence exists for settings UI
  await ensureDocumentSequence('INVOICE', cid)

  const { data, error } = await db
    .from('document_sequences')
    .select('*')
    .eq('company_id', cid)
    .order('document_type', { ascending: true })

  if (error) throw error
  return (data ?? []).map((row) => mapRow(row as Record<string, unknown>))
}

export async function getDocumentSequence(
  documentType: string,
  companyId?: string,
): Promise<DocumentSequenceRecord> {
  return ensureDocumentSequence(documentType, companyId)
}

/**
 * Atomically allocate the next formatted document number.
 * Uses DB row lock — safe under concurrent invoice creation.
 */
export async function allocateDocumentNumber(
  documentType: string,
  companyId?: string,
): Promise<string> {
  const db = supabaseDb()
  const cid = companyId ?? (await resolveCompanyId())
  const type = documentType.toUpperCase()

  const { data, error } = await db.rpc('allocate_document_number', {
    p_company_id: cid,
    p_document_type: type,
  })

  if (error) throw error
  if (typeof data !== 'string' || !data.trim()) {
    throw new Error('Failed to allocate document number')
  }
  return data
}

/** Lowest next_number allowed given already-issued documents for this type/prefix. */
export async function getMinAllowedNextNumber(
  documentType: string,
  prefix: string,
  companyId?: string,
): Promise<number> {
  const db = supabaseDb()
  const cid = companyId ?? (await resolveCompanyId())
  const type = documentType.toUpperCase()

  if (type !== 'INVOICE') {
    // Future: scan the relevant document table. For now only invoices are enforced.
    return 1
  }

  const { data, error } = await db
    .from('invoices')
    .select('invoice_no')
    .eq('company_id', cid)
    .is('deleted_at', null)

  if (error) throw error

  let max = 0
  for (const row of data ?? []) {
    const no = String((row as { invoice_no: string }).invoice_no ?? '')
    const n = extractTrailingSequenceNumber(no, prefix)
    if (n != null && n > max) max = n
  }
  return max + 1
}

export async function updateDocumentSequence(
  documentType: string,
  input: DocumentSequenceUpdateInput,
  companyId?: string,
): Promise<DocumentSequenceRecord> {
  const db = supabaseDb()
  const cid = companyId ?? (await resolveCompanyId())
  const existing = await ensureDocumentSequence(documentType, cid)

  const prefix = input.prefix !== undefined ? input.prefix : existing.prefix
  const minNext = await getMinAllowedNextNumber(documentType, prefix, cid)

  const validation = validateDocumentSequenceUpdate(
    {
      prefix: input.prefix ?? existing.prefix,
      startingNumber: input.startingNumber ?? existing.startingNumber,
      nextNumber: input.nextNumber ?? existing.nextNumber,
      padding: input.padding ?? existing.padding,
      suffix: input.suffix ?? existing.suffix,
    },
    { minNextNumber: minNext },
  )

  if (!validation.ok || !validation.normalized) {
    throw new Error(validation.errors.join('; '))
  }

  const { data, error } = await db
    .from('document_sequences')
    .update({
      prefix: validation.normalized.prefix,
      starting_number: validation.normalized.startingNumber,
      next_number: validation.normalized.nextNumber,
      padding: validation.normalized.padding,
      suffix: validation.normalized.suffix,
      updated_at: new Date().toISOString(),
    })
    .eq('id', existing.id)
    .eq('company_id', cid)
    .select('*')
    .single()

  if (error) throw error
  return mapRow(data as Record<string, unknown>)
}

export async function resetDocumentSequenceToDefault(
  documentType: string,
  companyId?: string,
): Promise<DocumentSequenceRecord> {
  const type = documentType.toUpperCase()
  const defaults = isDocumentType(type)
    ? DOCUMENT_TYPE_DEFAULTS[type]
    : { prefix: 'INV-', padding: 6, startingNumber: 1, label: type }

  const minNext = await getMinAllowedNextNumber(documentType, defaults.prefix, companyId)
  return updateDocumentSequence(
    documentType,
    {
      prefix: defaults.prefix,
      startingNumber: defaults.startingNumber,
      nextNumber: Math.max(defaults.startingNumber, minNext),
      padding: defaults.padding,
      suffix: '',
    },
    companyId,
  )
}

/** Seed default INVOICE sequence for a newly created company. */
export async function seedDefaultDocumentSequencesForCompany(
  companyId: string,
  invoicePrefix = 'INV-',
): Promise<void> {
  const db = supabaseDb()
  const { error } = await db.rpc('ensure_document_sequence', {
    p_company_id: companyId,
    p_document_type: 'INVOICE',
    p_prefix: invoicePrefix || 'INV-',
    p_padding: 6,
    p_starting_number: 1,
  })
  if (error) {
    // Fallback insert if RPC unavailable in some environments
    const { error: insertError } = await db.from('document_sequences').upsert(
      {
        company_id: companyId,
        document_type: 'INVOICE',
        prefix: invoicePrefix || 'INV-',
        starting_number: 1,
        next_number: 1,
        padding: 6,
        suffix: '',
      },
      { onConflict: 'company_id,document_type' },
    )
    if (insertError) throw insertError
  }
}

export function buildPreview(input: {
  prefix: string
  nextNumber: number
  padding: number
  suffix?: string
}): string {
  return previewDocumentNumber(input)
}

export { formatDocumentNumber, previewDocumentNumber }
