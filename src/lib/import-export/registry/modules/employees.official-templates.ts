import type { OfficialImportTemplate } from '../../types'

export const EMPLOYEE_OFFICIAL_TEMPLATES: OfficialImportTemplate[] = [
  {
    id: 'standard',
    name: 'hisab.ai Employees',
    columns: [
      { header: 'Employee ID', fieldKey: 'employeeNo', example: 'EMP-00001' },
      { header: 'Employee Name', fieldKey: 'name', required: true, example: 'Ahmed Al-Farsi' },
      { header: 'Department', fieldKey: 'department', example: 'Finance' },
      { header: 'Designation', fieldKey: 'position', example: 'Chief Accountant' },
      { header: 'Email', fieldKey: 'email', example: 'ahmed.alfarsi@company.com.sa' },
      { header: 'Phone', fieldKey: 'phone', example: '+966504445566' },
      { header: 'Hire Date', fieldKey: 'joiningDate', required: true, example: '2022-03-15' },
      { header: 'Salary', fieldKey: 'salary', example: '15000' },
      { header: 'Status', fieldKey: 'isActive', example: 'Active' },
    ],
  },
]
