import { requireAuth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getNextSequence } from '@/lib/sequences'
import { resolveCompanyId } from '@/lib/tenant'
import { maybeStartWorkflow } from '@/lib/workflow/integration'

export async function GET(request: Request) {
  try {
    await requireAuth()
    const { searchParams } = new URL(request.url)
    const search = searchParams.get('search') ?? ''
    const status = searchParams.get('status') ?? ''

    const entries = await prisma.journalEntry.findMany({
      where: {
        AND: [
          search ? {
            OR: [
              { entryNo: { contains: search } },
              { description: { contains: search } },
            ],
          } : {},
          status ? { status } : {},
        ],
      },
      include: { createdBy: { select: { name: true } }, lines: { include: { account: true } } },
      orderBy: { date: 'desc' },
    })

    return Response.json(entries)
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return Response.json({ error: String(error) }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireAuth()
    const body = await request.json()
    const { date, description, reference, lines } = body

    if (!lines || lines.length < 2) {
      return Response.json({ error: 'At least 2 lines required' }, { status: 400 })
    }

    const totalDebit = lines.reduce((s: number, l: { debit: number }) => s + (l.debit || 0), 0)
    const totalCredit = lines.reduce((s: number, l: { credit: number }) => s + (l.credit || 0), 0)

    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      return Response.json({ error: 'Debits must equal credits' }, { status: 400 })
    }

    const entryNo = await getNextSequence('JOURNAL', 'JV-')

    const entry = await prisma.journalEntry.create({
      data: {
        entryNo,
        date: new Date(date),
        description,
        reference,
        totalDebit,
        totalCredit,
        createdById: user.id,
        lines: {
          create: lines.map((l: {
            accountId: string; costCenterId?: string; description?: string;
            debit?: number; credit?: number; taxRate?: number
          }) => ({
            accountId: l.accountId,
            costCenterId: l.costCenterId || null,
            description: l.description,
            debit: l.debit || 0,
            credit: l.credit || 0,
            taxRate: l.taxRate || 0,
          })),
        },
      },
      include: { lines: { include: { account: true } } },
    })

    const companyId = await resolveCompanyId()
    await maybeStartWorkflow({
      entityType: 'JOURNAL_ENTRY',
      entityId: entry.id,
      entityLabel: entry.entryNo,
      amount: totalDebit,
      submittedById: user.id,
      companyId,
    })

    return Response.json(entry, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return Response.json({ error: String(error) }, { status: 500 })
  }
}
