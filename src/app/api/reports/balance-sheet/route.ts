import { requireAuth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

type JournalLineView = { debit: number; credit: number }
type AccountView = {
  accountNo: string
  fullName: string
  accountType: string
  journalLines: JournalLineView[]
}

export async function GET(request: Request) {
  try {
    await requireAuth()
    const { searchParams } = new URL(request.url)
    const asOf = searchParams.get('asOf') ? new Date(searchParams.get('asOf')!) : new Date()

    const accounts = await prisma.chartOfAccount.findMany({
      where: { subType: { not: 'Header' }, isActive: true },
      include: {
        journalLines: {
          where: { journal: { date: { lte: asOf }, status: 'POSTED' } },
        },
      },
      orderBy: { accountNo: 'asc' },
    })

    const sections: Record<string, { accountNo: string; name: string; balance: number }[]> = {
      Asset: [],
      Liability: [],
      Equity: [],
    }

    for (const acc of accounts as AccountView[]) {
      const debitTotal = acc.journalLines.reduce((s: number, l: JournalLineView) => s + l.debit, 0)
      const creditTotal = acc.journalLines.reduce((s: number, l: JournalLineView) => s + l.credit, 0)

      let balance = 0
      if (acc.accountType === 'Asset' || acc.accountType === 'Expense' || acc.accountType === 'CostOfGoodsSold') {
        balance = debitTotal - creditTotal
      } else {
        balance = creditTotal - debitTotal
      }

      if (acc.accountType in sections) {
        sections[acc.accountType].push({ accountNo: acc.accountNo, name: acc.fullName, balance })
      }
    }

    // Add AR from invoices
    const arBalance = await prisma.invoice.aggregate({
      where: { status: { in: ['SENT', 'PARTIAL', 'OVERDUE'] }, dueDate: { lte: asOf } },
      _sum: { balance: true },
    })

    // Add AP from bills
    const apBalance = await prisma.bill.aggregate({
      where: { status: { in: ['RECEIVED', 'PARTIAL', 'OVERDUE'] }, dueDate: { lte: asOf } },
      _sum: { balance: true },
    })

    const totalAssets = sections.Asset.reduce((s, a) => s + a.balance, 0)
    const totalLiabilities = sections.Liability.reduce((s, a) => s + a.balance, 0)
    const totalEquity = sections.Equity.reduce((s, a) => s + a.balance, 0)

    return Response.json({
      asOf: asOf.toISOString(),
      assets: { items: sections.Asset, total: totalAssets, ar: arBalance._sum.balance ?? 0 },
      liabilities: { items: sections.Liability, total: totalLiabilities, ap: apBalance._sum.balance ?? 0 },
      equity: { items: sections.Equity, total: totalEquity },
      totalLiabilitiesAndEquity: totalLiabilities + totalEquity,
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return Response.json({ error: String(error) }, { status: 500 })
  }
}
