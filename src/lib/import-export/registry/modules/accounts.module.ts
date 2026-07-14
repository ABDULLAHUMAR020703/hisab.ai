import 'server-only'
import type { ChartOfAccountRecord } from '@/lib/db/entities'
import { getAccountRepository } from '@/lib/db/provider'
import {
  parseBooleanField,
  parseOptionalString,
} from '../../parse-helpers'
import type { DuplicateMatch, MappedRow, ModuleDefinition } from '../../types'
import { ACCOUNT_FIELDS } from './accounts.fields'
import { ACCOUNT_OFFICIAL_TEMPLATES } from './accounts.official-templates'
import {
  deriveAccountNameFromFullName,
  deriveParentAccountNo,
} from '../../templates/row-transforms'

export { ACCOUNT_FIELDS } from './accounts.fields'

function parseAccountImportRow(mapped: Record<string, unknown>) {
  const name = String(mapped.name ?? '').trim()
  return {
    accountNo: String(mapped.accountNo ?? '').trim(),
    name,
    fullName: parseOptionalString(mapped.fullName) ?? name,
    parentNo: parseOptionalString(mapped.parentNo),
    accountType: String(mapped.accountType ?? '').trim(),
    subType: String(mapped.subType ?? '').trim(),
    description: parseOptionalString(mapped.description),
    isActive: parseBooleanField(mapped.isActive, true),
  }
}

export const accountsModule: ModuleDefinition = {
  key: 'accounts',
  displayName: 'Chart of Accounts',
  fields: ACCOUNT_FIELDS,
  officialTemplates: ACCOUNT_OFFICIAL_TEMPLATES,
  duplicateKeys: ['accountNo'],

  transformOfficialRow(mapped, templateId) {
    if (templateId !== 'standard') return mapped
    const accountNo = String(mapped.accountNo ?? '').trim()
    const fullName = String(mapped.fullName ?? '').trim()
    return {
      ...mapped,
      name: deriveAccountNameFromFullName(fullName),
      parentNo: deriveParentAccountNo(accountNo),
      isActive: true,
    }
  },

  parseImportRow: (mapped) => parseAccountImportRow(mapped) as unknown as Record<string, unknown>,

  async findDuplicate(record) {
    const parsed = parseAccountImportRow(record)
    const existing = await getAccountRepository().findDuplicate({ accountNo: parsed.accountNo })
    if (!existing) return null
    return { id: existing.id, matchedOn: ['accountNo'] }
  },

  async findDuplicatesBatch(rows: MappedRow[]) {
    const repo = getAccountRepository()
    const inputs = rows.map((row) => {
      const parsed = parseAccountImportRow(row.mapped)
      return { rowNumber: row.rowNumber, accountNo: parsed.accountNo }
    })
    const matches = await repo.findDuplicatesBatch(inputs)
    return matches.map((match): DuplicateMatch => ({
      rowNumber: match.rowNumber,
      existingId: match.existingId,
      matchedOn: match.matchedOn,
    }))
  },

  async createRecord(record) {
    const parsed = parseAccountImportRow(record)
    const created = await getAccountRepository().create(parsed)
    return { id: created.id }
  },

  async updateRecord(id, record) {
    const parsed = parseAccountImportRow(record)
    const { accountNo: _accountNo, ...update } = parsed
    await getAccountRepository().update(id, update)
  },

  async exportRecords(filters) {
    return getAccountRepository().findMany({
      search: filters.search || undefined,
      type: filters.type || undefined,
    })
  },

  mapExportRow(record) {
    const account = record as ChartOfAccountRecord
    return {
      accountNo: account.accountNo,
      name: account.name,
      fullName: account.fullName,
      parentNo: account.parentNo,
      accountType: account.accountType,
      subType: account.subType,
      description: account.description,
      isActive: account.isActive,
    }
  },
}
