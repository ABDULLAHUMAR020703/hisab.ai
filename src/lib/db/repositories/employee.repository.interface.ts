import type { EmployeeRecord } from '../entities'

export interface EmployeeListOptions {
  search?: string
}

export interface EmployeeBatchDuplicateInput {
  rowNumber: number
  email?: string | null
  employeeNo?: string | null
  name?: string | null
}

export interface EmployeeBatchDuplicateMatch {
  rowNumber: number
  existingId: string
  matchedOn: string[]
}

export interface EmployeeDuplicateCriteria {
  email?: string | null
  employeeNo?: string | null
  name?: string | null
}

export interface EmployeeCreateInput {
  name: string
  email?: string | null
  phone?: string | null
  department?: string | null
  position?: string | null
  joiningDate: Date
  salary?: number
  salaryType?: string
  bankAccount?: string | null
  isActive?: boolean
}

export interface EmployeeUpdateInput {
  name?: string
  email?: string | null
  phone?: string | null
  department?: string | null
  position?: string | null
  joiningDate?: Date
  salary?: number
  salaryType?: string
  bankAccount?: string | null
  isActive?: boolean
}

export interface EmployeeRepository {
  findMany(options?: EmployeeListOptions): Promise<EmployeeRecord[]>
  findById(id: string): Promise<EmployeeRecord | null>
  findDuplicate(criteria: EmployeeDuplicateCriteria): Promise<EmployeeRecord | null>
  findDuplicatesBatch(inputs: EmployeeBatchDuplicateInput[]): Promise<EmployeeBatchDuplicateMatch[]>
  create(input: EmployeeCreateInput): Promise<EmployeeRecord>
  update(id: string, input: EmployeeUpdateInput): Promise<EmployeeRecord>
  delete(id: string): Promise<void>
}
