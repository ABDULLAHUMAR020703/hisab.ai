import 'server-only'
import { createMasterRecord, listMasterRecords, updateMasterRecord } from '@/lib/master-data/repository'
import { createAdminClient } from '@/lib/supabase/admin'
import { parseBooleanField, parseNumberField, parseOptionalString } from '../../parse-helpers'
import type { DuplicateMatch, MappedRow, ModuleDefinition } from '../../types'
import { PAYMENT_TERM_FIELDS } from './payment-terms.fields'

interface PaymentTermRow {
  id: string
  name: string
  days: number
  description: string | null
  is_active: boolean
}

function parse(mapped: Record<string, unknown>) {
  return {
    name: String(mapped.name ?? '').trim(),
    days: parseNumberField(mapped.days, 0),
    description: parseOptionalString(mapped.description),
    is_active: parseBooleanField(mapped.isActive, true),
  }
}

async function existingByName(companyId: string) {
  const result = await createAdminClient().from('payment_terms').select('*').eq('company_id',companyId)
  if (result.error) throw result.error
  const rows = (result.data ?? []) as PaymentTermRow[]
  return new Map(rows.map((row) => [row.name.toLowerCase(), row]))
}

export const paymentTermsModule: ModuleDefinition = {
  key: 'payment-terms',
  displayName: 'Payment Terms',
  fields: PAYMENT_TERM_FIELDS,
  duplicateKeys: ['name'],

  parseImportRow: (mapped) => parse(mapped),

  async findDuplicate(record, ctx) {
    const match = (await existingByName(ctx.companyId)).get(parse(record).name.toLowerCase())
    return match ? { id: match.id, matchedOn: ['name'] } : null
  },

  async findDuplicatesBatch(rows: MappedRow[], ctx) {
    const existing = await existingByName(ctx.companyId)
    return rows.flatMap((row): DuplicateMatch[] => {
      const match = existing.get(parse(row.mapped).name.toLowerCase())
      return match ? [{ rowNumber: row.rowNumber, existingId: match.id, matchedOn: ['name'] }] : []
    })
  },

  async createRecord(record, ctx) {
    const created = await createMasterRecord('payment_terms', parse(record), ctx.companyId) as PaymentTermRow
    return { id: created.id }
  },

  async updateRecord(id, record, ctx) {
    await updateMasterRecord('payment_terms', id, parse(record), ctx.companyId)
  },

  async exportRecords(_filters, ctx) {
    return listMasterRecords('payment_terms', ctx.companyId)
  },

  mapExportRow(record) {
    const row = record as PaymentTermRow
    return { name: row.name, days: row.days, description: row.description, isActive: row.is_active }
  },
}
