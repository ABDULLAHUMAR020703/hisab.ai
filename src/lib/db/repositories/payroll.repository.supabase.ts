import 'server-only'
import { mapEmployeeRow, mapPayrollEntryRow, mapPayrollLineRow } from '../entity-mappers'
import type { PayrollEntryRecord } from '../entities'
import { queryByIdOrLegacy, resolveCompanyId, supabaseDb } from '../repository-utils'
import type { PayrollListOptions, PayrollRepository } from './payroll.repository.interface'

export const supabasePayrollRepository: PayrollRepository = {
  async findMany(options: PayrollListOptions = {}) {
    const db = supabaseDb()
    const companyId = await resolveCompanyId()
    const search = options.search?.trim()

    let query = db
      .from('payroll_entries')
      .select('*, employees(name, employee_no, department)')
      .eq('company_id', companyId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })

    const { data, error } = await query
    if (error) throw error

    let rows = data ?? []
    if (search) {
      const needle = search.toLowerCase()
      rows = rows.filter((row) => {
        const payrollNo = String(row.payroll_no).toLowerCase()
        const period = String(row.period).toLowerCase()
        const emp = row.employees as { name?: string } | null
        const empName = emp?.name?.toLowerCase() ?? ''
        return payrollNo.includes(needle) || period.includes(needle) || empName.includes(needle)
      })
    }

    const payrollIds = rows.map((r) => String(r.id))
    const linesByPayroll = new Map<string, ReturnType<typeof mapPayrollLineRow>[]>()

    if (payrollIds.length > 0) {
      const { data: lines, error: lineError } = await db
        .from('payroll_lines')
        .select('*')
        .eq('company_id', companyId)
        .in('payroll_id', payrollIds)
      if (lineError) throw lineError
      for (const line of lines ?? []) {
        const payrollId = String(line.payroll_id)
        const bucket = linesByPayroll.get(payrollId) ?? []
        bucket.push(mapPayrollLineRow(line))
        linesByPayroll.set(payrollId, bucket)
      }
    }

    return rows.map((row) => {
      const entry = mapPayrollEntryRow(row)
      const emp = row.employees as { name?: string; employee_no?: string; department?: string | null } | null
      return {
        ...entry,
        employee: emp
          ? { name: emp.name ?? '', employeeNo: emp.employee_no, department: emp.department ?? null }
          : undefined,
        lines: linesByPayroll.get(entry.id) ?? [],
      }
    })
  },

  async findById(id: string) {
    const db = supabaseDb()
    const companyId = await resolveCompanyId()
    const row = await queryByIdOrLegacy(db, 'payroll_entries', id, companyId)
    if (!row) return null

    const entry = mapPayrollEntryRow(row)
    const [employeeRes, linesRes] = await Promise.all([
      db.from('employees').select('*').eq('id', entry.employeeId).maybeSingle(),
      db.from('payroll_lines').select('*').eq('payroll_id', entry.id).eq('company_id', companyId),
    ])

    if (employeeRes.error) throw employeeRes.error
    if (linesRes.error) throw linesRes.error

    return {
      ...entry,
      employee: employeeRes.data ? mapEmployeeRow(employeeRes.data) : undefined,
      lines: (linesRes.data ?? []).map(mapPayrollLineRow),
    } as PayrollEntryRecord
  },
}
