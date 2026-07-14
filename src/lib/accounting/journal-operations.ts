import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCompanyId } from '@/lib/tenant'
import { getNextSequence } from '@/lib/sequences'
import { postJournalEntry } from './posting-service'
import { validatePostingContext, validateNoDuplicatePosting } from './validation'
import { logPostingAudit } from './posting-audit'
import type { JournalEntryType } from './types'

interface JournalWithLines {
  id: string
  entryNo: string
  date: Date
  description: string
  reference: string | null
  status: string
  totalDebit: number
  totalCredit: number
  currency?: string
  lines: Array<{
    accountId: string
    costCenterId?: string | null
    description?: string | null
    debit: number
    credit: number
    taxRate?: number
  }>
}

async function loadJournal(journalId: string, companyId: string): Promise<JournalWithLines | null> {
  const client = createAdminClient()
  const { data: entry, error } = await client
    .from('journal_entries')
    .select('*')
    .eq('id', journalId)
    .eq('company_id', companyId)
    .is('deleted_at', null)
    .single()

  if (error || !entry) return null

  const { data: lines, error: linesError } = await client
    .from('journal_lines')
    .select('*')
    .eq('journal_id', journalId)
    .eq('company_id', companyId)

  if (linesError) throw linesError

  return {
    id: String(entry.id),
    entryNo: String(entry.entry_no),
    date: new Date(String(entry.date)),
    description: String(entry.description),
    reference: (entry.reference as string | null) ?? null,
    status: String(entry.status),
    totalDebit: Number(entry.total_debit),
    totalCredit: Number(entry.total_credit),
    currency: String(entry.currency ?? 'SAR'),
    lines: (lines ?? []).map((l) => ({
      accountId: String(l.account_id),
      costCenterId: (l.cost_center_id as string | null) ?? null,
      description: (l.description as string | null) ?? null,
      debit: Number(l.debit),
      credit: Number(l.credit),
      taxRate: Number(l.tax_rate ?? 0),
    })),
  }
}

async function createJournalDraft(options: {
  companyId: string
  userId: string
  entryType: JournalEntryType
  date: Date
  description: string
  reference?: string | null
  sourceJournalId?: string | null
  postReason?: string | null
  currency?: string
  lines: JournalWithLines['lines']
}): Promise<string> {
  const client = createAdminClient()
  const entryNo = await getNextSequence('JOURNAL', 'JV-')
  const totalDebit = options.lines.reduce((s, l) => s + l.debit, 0)
  const totalCredit = options.lines.reduce((s, l) => s + l.credit, 0)

  const { data: entry, error } = await client
    .from('journal_entries')
    .insert({
      company_id: options.companyId,
      entry_no: entryNo,
      date: options.date.toISOString(),
      description: options.description,
      reference: options.reference ?? null,
      status: 'DRAFT',
      total_debit: totalDebit,
      total_credit: totalCredit,
      created_by_id: options.userId,
      entry_type: options.entryType,
      source_journal_id: options.sourceJournalId ?? null,
      post_reason: options.postReason ?? null,
      currency: options.currency ?? 'SAR',
    })
    .select('id')
    .single()

  if (error) throw error

  const journalId = String(entry.id)
  const lineRows = options.lines.map((l) => ({
    company_id: options.companyId,
    journal_id: journalId,
    account_id: l.accountId,
    cost_center_id: l.costCenterId ?? null,
    description: l.description ?? null,
    debit: l.debit,
    credit: l.credit,
    tax_rate: l.taxRate ?? 0,
  }))

  const { error: lineError } = await client.from('journal_lines').insert(lineRows)
  if (lineError) throw lineError

  return journalId
}

export async function reverseJournalEntry(options: {
  journalId: string
  userId: string
  reason: string
  reversalDate?: Date
  companyId?: string
  ipAddress?: string | null
}): Promise<{ reversalJournalId: string; postingSequence: number }> {
  const companyId = options.companyId ?? await resolveCompanyId()
  const source = await loadJournal(options.journalId, companyId)

  if (!source) throw new Error('Journal entry not found')
  if (source.status !== 'POSTED') throw new Error('Only posted entries can be reversed')

  const client = createAdminClient()
  const { data: existingReverse } = await client
    .from('journal_entries')
    .select('id')
    .eq('company_id', companyId)
    .eq('source_journal_id', options.journalId)
    .eq('entry_type', 'REVERSING')
    .neq('status', 'DRAFT')
    .limit(1)

  if (existingReverse && existingReverse.length > 0) {
    throw new Error('This journal entry has already been reversed')
  }

  const reversedLines = source.lines.map((l) => ({
    ...l,
    debit: l.credit,
    credit: l.debit,
    description: l.description ? `Reversal: ${l.description}` : 'Reversal',
  }))

  await validatePostingContext({
    companyId,
    entryDate: options.reversalDate ?? new Date(),
    lines: reversedLines,
    currency: source.currency,
  })

  const reversalJournalId = await createJournalDraft({
    companyId,
    userId: options.userId,
    entryType: 'REVERSING',
    date: options.reversalDate ?? new Date(),
    description: `Reversal of ${source.entryNo}: ${source.description}`,
    reference: source.reference,
    sourceJournalId: options.journalId,
    postReason: options.reason,
    currency: source.currency,
    lines: reversedLines,
  })

  await validateNoDuplicatePosting(companyId, reversalJournalId)
  await postJournalEntry(reversalJournalId, { companyId, userId: options.userId, reason: options.reason, ipAddress: options.ipAddress })

  await client
    .from('journal_entries')
    .update({ reversed_by_journal_id: reversalJournalId })
    .eq('id', options.journalId)
    .eq('company_id', companyId)

  const { data: posted } = await client
    .from('journal_entries')
    .select('posting_sequence')
    .eq('id', reversalJournalId)
    .single()

  await logPostingAudit({
    action: 'JOURNAL_REVERSED',
    entityType: 'journal_entry',
    entityId: reversalJournalId,
    userId: options.userId,
    companyId,
    reason: options.reason,
    ipAddress: options.ipAddress,
    beforeState: { sourceJournalId: options.journalId, sourceStatus: 'POSTED' },
    afterState: { reversalJournalId, postingSequence: posted?.posting_sequence },
  })

  return {
    reversalJournalId,
    postingSequence: Number(posted?.posting_sequence ?? 0),
  }
}

export async function createAdjustingJournalEntry(options: {
  journalId: string
  userId: string
  reason: string
  date: Date
  lines: JournalWithLines['lines']
  companyId?: string
  ipAddress?: string | null
  autoPost?: boolean
}): Promise<{ adjustingJournalId: string; postingSequence?: number }> {
  const companyId = options.companyId ?? await resolveCompanyId()
  const source = await loadJournal(options.journalId, companyId)
  if (!source) throw new Error('Source journal entry not found')
  if (source.status !== 'POSTED') throw new Error('Adjustments require a posted source entry')

  await validatePostingContext({
    companyId,
    entryDate: options.date,
    lines: options.lines.map((line) => ({
      accountId: line.accountId,
      debit: line.debit,
      credit: line.credit,
      costCenterId: line.costCenterId,
      taxRate: line.taxRate,
      description: line.description ?? undefined,
    })),
    currency: source.currency,
  })

  const adjustingJournalId = await createJournalDraft({
    companyId,
    userId: options.userId,
    entryType: 'ADJUSTING',
    date: options.date,
    description: `Adjustment to ${source.entryNo}: ${options.reason}`,
    reference: source.reference,
    sourceJournalId: options.journalId,
    postReason: options.reason,
    currency: source.currency,
    lines: options.lines,
  })

  let postingSequence: number | undefined
  if (options.autoPost !== false) {
    await validateNoDuplicatePosting(companyId, adjustingJournalId)
    await postJournalEntry(adjustingJournalId, { companyId, userId: options.userId, reason: options.reason, ipAddress: options.ipAddress })
    const client = createAdminClient()
    const { data: posted } = await client
      .from('journal_entries')
      .select('posting_sequence')
      .eq('id', adjustingJournalId)
      .single()
    postingSequence = Number(posted?.posting_sequence ?? 0)
  }

  await logPostingAudit({
    action: 'JOURNAL_ADJUSTED',
    entityType: 'journal_entry',
    entityId: adjustingJournalId,
    userId: options.userId,
    companyId,
    reason: options.reason,
    ipAddress: options.ipAddress,
    beforeState: { sourceJournalId: options.journalId },
    afterState: { adjustingJournalId, postingSequence, autoPosted: options.autoPost !== false },
  })

  return { adjustingJournalId, postingSequence }
}

export async function cloneJournalEntry(options: {
  journalId: string
  userId: string
  companyId?: string
}): Promise<{ clonedJournalId: string }> {
  const companyId = options.companyId ?? await resolveCompanyId()
  const source = await loadJournal(options.journalId, companyId)
  if (!source) throw new Error('Journal entry not found')

  const clonedJournalId = await createJournalDraft({
    companyId,
    userId: options.userId,
    entryType: 'STANDARD',
    date: new Date(),
    description: `Copy of ${source.entryNo}: ${source.description}`,
    reference: source.reference,
    sourceJournalId: options.journalId,
    currency: source.currency,
    lines: source.lines.map((l) => ({ ...l })),
  })

  return { clonedJournalId }
}
