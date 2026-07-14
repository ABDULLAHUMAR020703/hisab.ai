import 'server-only'
import { mapEmployeeRow } from '../entity-mappers'
import type { EmployeeRecord } from '../entities'
import { queryByIdOrLegacy, resolveCompanyId, supabaseDb } from '../repository-utils'
import { resolveSequenceRepository } from '../sequence-resolver'
import type {
  EmployeeBatchDuplicateInput,
  EmployeeBatchDuplicateMatch,
  EmployeeCreateInput,
  EmployeeDuplicateCriteria,
  EmployeeListOptions,
  EmployeeRepository,
  EmployeeUpdateInput,
} from './employee.repository.interface'

async function resolveEmployeeUuid(id: string, companyId: string): Promise<string | null> {
  const row = await queryByIdOrLegacy(supabaseDb(), 'employees', id, companyId)
  return row ? String(row.id) : null
}

export const supabaseEmployeeRepository: EmployeeRepository = {
  async findMany(options: EmployeeListOptions = {}) {
    const db = supabaseDb()
    const companyId = await resolveCompanyId()
    const search = options.search?.trim()

    let query = db
      .from('employees')
      .select('*')
      .eq('company_id', companyId)
      .is('deleted_at', null)
      .order('name', { ascending: true })

    if (search) {
      query = query.or(
        `name.ilike.%${search}%,employee_no.ilike.%${search}%,department.ilike.%${search}%`,
      )
    }

    const { data, error } = await query
    if (error) throw error
    return (data ?? []).map(mapEmployeeRow)
  },

  async findById(id: string) {
    const db = supabaseDb()
    const companyId = await resolveCompanyId()
    const row = await queryByIdOrLegacy(db, 'employees', id, companyId)
    return row ? mapEmployeeRow(row) : null
  },

  async findDuplicate(criteria: EmployeeDuplicateCriteria) {
    const db = supabaseDb()
    const companyId = await resolveCompanyId()

    const email = criteria.email?.trim()
    if (email) {
      const { data, error } = await db
        .from('employees')
        .select('*')
        .eq('company_id', companyId)
        .ilike('email', email)
        .is('deleted_at', null)
        .limit(1)
        .maybeSingle()
      if (error) throw error
      if (data) return mapEmployeeRow(data)
    }

    const employeeNo = criteria.employeeNo?.trim()
    if (employeeNo) {
      const { data, error } = await db
        .from('employees')
        .select('*')
        .eq('company_id', companyId)
        .eq('employee_no', employeeNo)
        .is('deleted_at', null)
        .limit(1)
        .maybeSingle()
      if (error) throw error
      if (data) return mapEmployeeRow(data)
    }

    const name = criteria.name?.trim()
    if (name) {
      const { data, error } = await db
        .from('employees')
        .select('*')
        .eq('company_id', companyId)
        .ilike('name', name)
        .is('deleted_at', null)
        .limit(1)
        .maybeSingle()
      if (error) throw error
      if (data) return mapEmployeeRow(data)
    }

    return null
  },

  async findDuplicatesBatch(inputs: EmployeeBatchDuplicateInput[]) {
    if (inputs.length === 0) return []

    const db = supabaseDb()
    const companyId = await resolveCompanyId()

    const employeeNos = [...new Set(inputs.map((item) => item.employeeNo?.trim()).filter(Boolean) as string[])]
    const emails = [...new Set(inputs.map((item) => item.email?.trim().toLowerCase()).filter(Boolean) as string[])]
    const names = [...new Set(inputs.map((item) => item.name?.trim().toLowerCase()).filter(Boolean) as string[])]

    const byEmployeeNo = new Map<string, EmployeeRecord>()
    const byEmail = new Map<string, EmployeeRecord>()
    const byName = new Map<string, EmployeeRecord>()

    if (employeeNos.length > 0) {
      const { data, error } = await db
        .from('employees')
        .select('*')
        .eq('company_id', companyId)
        .in('employee_no', employeeNos)
        .is('deleted_at', null)
      if (error) throw error
      for (const row of data ?? []) {
        const employee = mapEmployeeRow(row)
        byEmployeeNo.set(employee.employeeNo, employee)
      }
    }

    if (emails.length > 0 || names.length > 0) {
      const { data, error } = await db
        .from('employees')
        .select('id, employee_no, email, name')
        .eq('company_id', companyId)
        .is('deleted_at', null)
      if (error) throw error

      const emailSet = new Set(emails)
      const nameSet = new Set(names)

      for (const row of data ?? []) {
        const employee = mapEmployeeRow(row)
        if (employee.email && emailSet.has(employee.email.toLowerCase())) {
          byEmail.set(employee.email.toLowerCase(), employee)
        }
        if (nameSet.has(employee.name.toLowerCase())) {
          byName.set(employee.name.toLowerCase(), employee)
        }
      }
    }

    const matches: EmployeeBatchDuplicateMatch[] = []
    for (const input of inputs) {
      const email = input.email?.trim().toLowerCase()
      const employeeNo = input.employeeNo?.trim()
      const name = input.name?.trim().toLowerCase()

      let existing: EmployeeRecord | undefined
      const matchedOn: string[] = []

      if (email && byEmail.has(email)) {
        existing = byEmail.get(email)
        matchedOn.push('email')
      } else if (employeeNo && byEmployeeNo.has(employeeNo)) {
        existing = byEmployeeNo.get(employeeNo)
        matchedOn.push('employeeNo')
      } else if (name && byName.has(name)) {
        existing = byName.get(name)
        matchedOn.push('name')
      }

      if (existing) {
        matches.push({
          rowNumber: input.rowNumber,
          existingId: existing.id,
          matchedOn: matchedOn.length ? matchedOn : ['name'],
        })
      }
    }

    return matches
  },

  async create(input: EmployeeCreateInput) {
    const db = supabaseDb()
    const companyId = await resolveCompanyId()
    const employeeNo = await resolveSequenceRepository().next('EMPLOYEE', 'EMP-')

    const { data, error } = await db
      .from('employees')
      .insert({
        company_id: companyId,
        employee_no: employeeNo,
        name: input.name,
        email: input.email ?? null,
        phone: input.phone ?? null,
        department: input.department ?? null,
        position: input.position ?? null,
        joining_date: input.joiningDate.toISOString(),
        salary: input.salary ?? 0,
        salary_type: input.salaryType ?? 'MONTHLY',
        bank_account: input.bankAccount ?? null,
        is_active: input.isActive ?? true,
      })
      .select('*')
      .single()

    if (error) throw error
    return mapEmployeeRow(data)
  },

  async update(id: string, input: EmployeeUpdateInput) {
    const db = supabaseDb()
    const companyId = await resolveCompanyId()
    const employeeId = await resolveEmployeeUuid(id, companyId)
    if (!employeeId) throw new Error('Employee not found')

    const patch: Record<string, unknown> = {}
    if (input.name !== undefined) patch.name = input.name
    if (input.email !== undefined) patch.email = input.email
    if (input.phone !== undefined) patch.phone = input.phone
    if (input.department !== undefined) patch.department = input.department
    if (input.position !== undefined) patch.position = input.position
    if (input.joiningDate !== undefined) patch.joining_date = input.joiningDate.toISOString()
    if (input.salary !== undefined) patch.salary = input.salary
    if (input.salaryType !== undefined) patch.salary_type = input.salaryType
    if (input.bankAccount !== undefined) patch.bank_account = input.bankAccount
    if (input.isActive !== undefined) patch.is_active = input.isActive

    const { data, error } = await db
      .from('employees')
      .update(patch)
      .eq('id', employeeId)
      .eq('company_id', companyId)
      .is('deleted_at', null)
      .select('*')
      .single()

    if (error) throw error
    return mapEmployeeRow(data)
  },

  async delete(id: string) {
    const db = supabaseDb()
    const companyId = await resolveCompanyId()
    const employeeId = await resolveEmployeeUuid(id, companyId)
    if (!employeeId) throw new Error('Employee not found')

    const { error } = await db
      .from('employees')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', employeeId)
      .eq('company_id', companyId)

    if (error) throw error
  },
}
