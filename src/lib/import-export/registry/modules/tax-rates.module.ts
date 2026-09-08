import 'server-only'
import type { TaxRateRecord } from '@/lib/db/entities'
import { getTaxRateRepository } from '@/lib/db/provider'
import {
  parseBooleanField,
  parseNumberField,
  parseOptionalString,
} from '../../parse-helpers'
import type { DuplicateMatch, MappedRow, ModuleDefinition } from '../../types'
import { TAX_RATE_FIELDS } from './tax-rates.fields'
import { TAX_RATE_OFFICIAL_TEMPLATES } from './tax-rates.official-templates'

export { TAX_RATE_FIELDS } from './tax-rates.fields'

function parseTaxRateImportRow(mapped: Record<string, unknown>) {
  const parsed: {
    name: string
    rate: number
    type: string
    isDefault: boolean
    isActive: boolean
    isReverseCharge?: boolean
  } = {
    name: String(mapped.name ?? '').trim(),
    rate: parseNumberField(mapped.rate, 0),
    type: parseOptionalString(mapped.type)?.toUpperCase() ?? 'VAT',
    isDefault: parseBooleanField(mapped.isDefault, false),
    isActive: parseBooleanField(mapped.isActive, true),
  }
  // Only carried through when the source row set it (QuickBooks
  // SpecialTaxType = REVERSE_CHARGE). Absent → repository leaves the column at
  // its default (false), so CSV / official-template imports are unaffected.
  if (mapped.isReverseCharge !== undefined) {
    parsed.isReverseCharge = parseBooleanField(mapped.isReverseCharge, false)
  }
  return parsed
}

export const taxRatesModule: ModuleDefinition = {
  key: 'tax-rates',
  displayName: 'Tax Rates',
  fields: TAX_RATE_FIELDS,
  officialTemplates: TAX_RATE_OFFICIAL_TEMPLATES,
  duplicateKeys: ['name'],

  transformOfficialRow(mapped, templateId) {
    if (templateId !== 'standard') return mapped
    const { taxDescription: _desc, ...rest } = mapped
    return rest
  },

  parseImportRow: (mapped) => parseTaxRateImportRow(mapped) as unknown as Record<string, unknown>,

  async findDuplicate(record) {
    const parsed = parseTaxRateImportRow(record)
    const existing = await getTaxRateRepository().findDuplicate({ name: parsed.name })
    if (!existing) return null
    return { id: existing.id, matchedOn: ['name'] }
  },

  async findDuplicatesBatch(rows: MappedRow[]) {
    const repo = getTaxRateRepository()
    const inputs = rows.map((row) => {
      const parsed = parseTaxRateImportRow(row.mapped)
      return { rowNumber: row.rowNumber, name: parsed.name }
    })
    const matches = await repo.findDuplicatesBatch(inputs)
    return matches.map((match): DuplicateMatch => ({
      rowNumber: match.rowNumber,
      existingId: match.existingId,
      matchedOn: match.matchedOn,
    }))
  },

  async createRecord(record) {
    const parsed = parseTaxRateImportRow(record)
    const created = await getTaxRateRepository().create(parsed)
    return { id: created.id }
  },

  async updateRecord(id, record) {
    const parsed = parseTaxRateImportRow(record)
    await getTaxRateRepository().update(id, parsed)
  },

  async exportRecords(_filters) {
    return getTaxRateRepository().findMany()
  },

  mapExportRow(record) {
    const taxRate = record as TaxRateRecord
    return {
      name: taxRate.name,
      rate: taxRate.rate,
      type: taxRate.type,
      isDefault: taxRate.isDefault,
      isReverseCharge: taxRate.isReverseCharge,
      isActive: taxRate.isActive,
    }
  },
}
