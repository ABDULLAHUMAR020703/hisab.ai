import 'server-only'
import type { EmployeeRecord } from '@/lib/db/entities'
import { getEmployeeRepository } from '@/lib/db/provider'
import {
  parseBooleanField,
  parseDateField,
  parseNumberField,
  parseOptionalString,
} from '../../parse-helpers'
import type { DuplicateMatch, MappedRow, ModuleDefinition } from '../../types'
import { EMPLOYEE_FIELDS } from './employees.fields'
import { EMPLOYEE_OFFICIAL_TEMPLATES } from './employees.official-templates'

export { EMPLOYEE_FIELDS } from './employees.fields'

function parseEmployeeImportRow(mapped: Record<string, unknown>) {
  const joiningDate = parseDateField(mapped.joiningDate)
  return {
    name: String(mapped.name ?? '').trim(),
    email: parseOptionalString(mapped.email),
    phone: parseOptionalString(mapped.phone),
    department: parseOptionalString(mapped.department),
    position: parseOptionalString(mapped.position),
    joiningDate,
    salary: parseNumberField(mapped.salary, 0),
    salaryType: parseOptionalString(mapped.salaryType)?.toUpperCase() ?? 'MONTHLY',
    bankAccount: parseOptionalString(mapped.bankAccount),
    isActive: parseBooleanField(mapped.isActive, true),
  }
}

function matchEmployeeDuplicate(
  parsed: ReturnType<typeof parseEmployeeImportRow>,
  existing: EmployeeRecord,
): string[] {
  const matchedOn: string[] = []
  if (parsed.email && existing.email?.toLowerCase() === parsed.email.toLowerCase()) {
    matchedOn.push('email')
  } else if (parsed.name && existing.name.toLowerCase() === parsed.name.toLowerCase()) {
    matchedOn.push('name')
  }
  return matchedOn
}

export const employeesModule: ModuleDefinition = {
  key: 'employees',
  displayName: 'Employees',
  fields: EMPLOYEE_FIELDS,
  officialTemplates: EMPLOYEE_OFFICIAL_TEMPLATES,
  duplicateKeys: ['email', 'name'],

  parseImportRow: (mapped) => parseEmployeeImportRow(mapped) as unknown as Record<string, unknown>,

  async findDuplicate(record) {
    const parsed = parseEmployeeImportRow(record)
    const existing = await getEmployeeRepository().findDuplicate({
      email: parsed.email,
      name: parsed.name,
    })
    if (!existing) return null
    const matchedOn = matchEmployeeDuplicate(parsed, existing)
    return { id: existing.id, matchedOn: matchedOn.length ? matchedOn : ['name'] }
  },

  async findDuplicatesBatch(rows: MappedRow[]) {
    const repo = getEmployeeRepository()
    const inputs = rows.map((row) => {
      const parsed = parseEmployeeImportRow(row.mapped)
      return {
        rowNumber: row.rowNumber,
        email: parsed.email,
        name: parsed.name,
      }
    })
    const matches = await repo.findDuplicatesBatch(inputs)
    return matches.map((match): DuplicateMatch => ({
      rowNumber: match.rowNumber,
      existingId: match.existingId,
      matchedOn: match.matchedOn,
    }))
  },

  async createRecord(record) {
    const parsed = parseEmployeeImportRow(record)
    if (!parsed.joiningDate) {
      throw new Error('Joining date is required')
    }
    const created = await getEmployeeRepository().create({
      ...parsed,
      joiningDate: parsed.joiningDate,
    })
    return { id: created.id }
  },

  async updateRecord(id, record) {
    const parsed = parseEmployeeImportRow(record)
    const update = {
      ...parsed,
      joiningDate: parsed.joiningDate ?? undefined,
    }
    await getEmployeeRepository().update(id, update)
  },

  async exportRecords(filters) {
    return getEmployeeRepository().findMany({ search: filters.search || undefined })
  },

  mapExportRow(record) {
    const employee = record as EmployeeRecord
    return {
      employeeNo: employee.employeeNo,
      name: employee.name,
      email: employee.email,
      phone: employee.phone,
      department: employee.department,
      position: employee.position,
      joiningDate: employee.joiningDate.toISOString().split('T')[0],
      salary: employee.salary,
      salaryType: employee.salaryType,
      bankAccount: employee.bankAccount,
      isActive: employee.isActive,
    }
  },
}
