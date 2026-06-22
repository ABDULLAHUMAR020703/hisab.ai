import { requireAuth } from '@/lib/auth'
import { getPayrollRepository } from '@/lib/db/provider'
import { prisma } from '@/lib/prisma'
import { getNextSequence } from '@/lib/sequences'

export async function GET(request: Request) {
  try {
    await requireAuth()
    const { searchParams } = new URL(request.url)
    const search = searchParams.get('search') ?? undefined
    const payrolls = await getPayrollRepository().findMany({ search })
    return Response.json(payrolls)
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return Response.json({ error: String(error) }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    await requireAuth()
    const body = await request.json()
    const { employeeId, periodStart, periodEnd, period, allowances, deductions, notes } = body

    if (!employeeId) {
      return Response.json({ error: 'employeeId is required' }, { status: 400 })
    }

    const start = periodStart
      ? new Date(periodStart)
      : period
        ? new Date(`${period}-01T00:00:00.000Z`)
        : null
    const end = periodEnd
      ? new Date(periodEnd)
      : start
        ? new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0))
        : null

    if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return Response.json({ error: 'period or periodStart/periodEnd is required' }, { status: 400 })
    }

    const employee = await prisma.employee.findUnique({ where: { id: employeeId } })
    if (!employee) return Response.json({ error: 'Employee not found' }, { status: 404 })

    const basicSalary = employee.salary
    const totalAllowances = allowances || 0
    const totalDeductions = deductions || 0
    const grossSalary = basicSalary + totalAllowances
    const taxAmount = 0
    const netSalary = grossSalary - totalDeductions - taxAmount

    const payrollNo = await getNextSequence('PAYROLL', 'PRL-')

    const payroll = await prisma.payrollEntry.create({
      data: {
        payrollNo,
        employeeId,
        period: period || start.toLocaleString('en', { month: 'long', year: 'numeric' }),
        periodStart: start,
        periodEnd: end,
        basicSalary,
        allowances: totalAllowances,
        deductions: totalDeductions,
        taxAmount,
        netSalary,
        notes,
        lines: {
          create: [
            { type: 'EARNING', description: 'Basic Salary', amount: basicSalary },
            ...(totalAllowances > 0 ? [{ type: 'EARNING', description: 'Allowances', amount: totalAllowances }] : []),
            ...(totalDeductions > 0 ? [{ type: 'DEDUCTION', description: 'Deductions', amount: totalDeductions }] : []),
          ],
        },
      },
      include: { employee: { select: { name: true } }, lines: true },
    })

    return Response.json(payroll, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return Response.json({ error: String(error) }, { status: 500 })
  }
}
