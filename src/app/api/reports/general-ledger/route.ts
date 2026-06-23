import { requireAuth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

type LedgerLineView = {
  debit: number
  credit: number
  description?: string | null
  journal: { date: Date; entryNo: string; description: string; status: string }
  account: unknown
  costCenter: unknown
}

export async function GET(request: Request) {
  try {
    await requireAuth()
    const { searchParams } = new URL(request.url)
    const accountId = searchParams.get('accountId')
    const from = searchParams.get('from') ? new Date(searchParams.get('from')!) : new Date(new Date().getFullYear(), 0, 1)
    const to = searchParams.get('to') ? new Date(searchParams.get('to')!) : new Date()

    const lines = await prisma.journalLine.findMany({
      where: {
        accountId: accountId || undefined,
        journal: { date: { gte: from, lte: to } },
      },
      include: {
        journal: { select: { entryNo: true, date: true, description: true, status: true } },
        account: { select: { accountNo: true, name: true, accountType: true } },
        costCenter: { select: { name: true } },
      },
      orderBy: { journal: { date: 'asc' } },
    })

    let runningBalance = 0
    const ledgerLines = lines as LedgerLineView[]
    const entries = ledgerLines.map((line: LedgerLineView) => {
      runningBalance += line.debit - line.credit
      return {
        date: line.journal.date,
        entryNo: line.journal.entryNo,
        description: line.description || line.journal.description,
        debit: line.debit,
        credit: line.credit,
        balance: runningBalance,
        status: line.journal.status,
        account: line.account,
        costCenter: line.costCenter,
      }
    })

    const totalDebit = ledgerLines.reduce((s: number, l: LedgerLineView) => s + l.debit, 0)
    const totalCredit = ledgerLines.reduce((s: number, l: LedgerLineView) => s + l.credit, 0)

    return Response.json({
      period: { from: from.toISOString(), to: to.toISOString() },
      entries,
      totals: { debit: totalDebit, credit: totalCredit, balance: totalDebit - totalCredit },
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return Response.json({ error: String(error) }, { status: 500 })
  }
}
