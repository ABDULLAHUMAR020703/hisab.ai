import 'server-only'
import type { CostCenterRecord } from '@/lib/db/entities'
import { getCostCenterRepository } from '@/lib/db/provider'
import {
  parseBooleanField,
  parseOptionalString,
} from '../../parse-helpers'
import type { DuplicateMatch, MappedRow, ModuleDefinition } from '../../types'
import { COST_CENTER_FIELDS } from './cost-centers.fields'
import { COST_CENTER_OFFICIAL_TEMPLATES } from './cost-centers.official-templates'
import { parseClassFullName, slugifyCode } from '../../templates/row-transforms'

export { COST_CENTER_FIELDS } from './cost-centers.fields'

function parseCostCenterImportRow(mapped: Record<string, unknown>) {
  return {
    code: parseOptionalString(mapped.code) ?? undefined,
    name: String(mapped.name ?? '').trim(),
    type: parseOptionalString(mapped.type)?.toUpperCase() ?? 'PROJECT',
    description: parseOptionalString(mapped.description),
    isActive: parseBooleanField(mapped.isActive, true),
  }
}

export const costCentersModule: ModuleDefinition = {
  key: 'cost-centers',
  displayName: 'Cost Centers',
  fields: COST_CENTER_FIELDS,
  officialTemplates: COST_CENTER_OFFICIAL_TEMPLATES,
  duplicateKeys: ['code', 'name'],

  transformOfficialRow(mapped, templateId) {
    if (templateId === 'classes') {
      const { name, description } = parseClassFullName(String(mapped.classFullName ?? ''))
      return { name, description, type: 'CLASS', isActive: true }
    }
    if (templateId === 'locations') {
      const name = String(mapped.locationFullName ?? '').trim()
      return { name, code: slugifyCode(name), type: 'LOCATION', isActive: true }
    }
    return mapped
  },

  parseImportRow: (mapped) => parseCostCenterImportRow(mapped) as unknown as Record<string, unknown>,

  async findDuplicate(record) {
    const parsed = parseCostCenterImportRow(record)
    const existing = await getCostCenterRepository().findDuplicate({
      code: parsed.code,
      name: parsed.name,
    })
    if (!existing) return null
    const matchedOn: string[] = []
    if (parsed.code && existing.code === parsed.code) matchedOn.push('code')
    else if (parsed.name && existing.name.toLowerCase() === parsed.name.toLowerCase()) matchedOn.push('name')
    return { id: existing.id, matchedOn: matchedOn.length ? matchedOn : ['name'] }
  },

  async findDuplicatesBatch(rows: MappedRow[]) {
    const repo = getCostCenterRepository()
    const inputs = rows.map((row) => {
      const parsed = parseCostCenterImportRow(row.mapped)
      return { rowNumber: row.rowNumber, code: parsed.code, name: parsed.name }
    })
    const matches = await repo.findDuplicatesBatch(inputs)
    return matches.map((match): DuplicateMatch => ({
      rowNumber: match.rowNumber,
      existingId: match.existingId,
      matchedOn: match.matchedOn,
    }))
  },

  async createRecord(record) {
    const parsed = parseCostCenterImportRow(record)
    const created = await getCostCenterRepository().create(parsed)
    return { id: created.id }
  },

  async updateRecord(id, record) {
    const parsed = parseCostCenterImportRow(record)
    const { code: _code, ...update } = parsed
    await getCostCenterRepository().update(id, update)
  },

  async exportRecords(filters) {
    return getCostCenterRepository().findMany({ search: filters.search || undefined })
  },

  mapExportRow(record) {
    const center = record as CostCenterRecord
    return {
      code: center.code,
      name: center.name,
      type: center.type,
      description: center.description,
      isActive: center.isActive,
    }
  },
}
