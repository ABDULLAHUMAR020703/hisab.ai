import { randomUUID } from 'crypto'
import { requireAuth } from '@/lib/auth'
import { logAudit } from '@/lib/audit/log'
import { postSourceDocumentToLedger } from '@/lib/accounting/posting-service'
import type { PostingLine } from '@/lib/accounting/posting-service'
import { prisma } from '@/lib/prisma'
import { resolveCompanyId } from '@/lib/tenant'
import { getNextSequence } from '@/lib/sequences'

export async function POST(request: Request) {
  try {
    const user = await requireAuth()
    const companyId = await resolveCompanyId()
    const body = await request.json()
    const { date, description, lines } = body

    if (!lines?.length || lines.length < 2) {
      return Response.json({ error: 'At least 2 opening balance lines required' }, { status: 400 })
    }

    const totalDebit = lines.reduce((s: number, l: { debit?: number }) => s + (l.debit || 0), 0)
    const totalCredit = lines.reduce((s: number, l: { credit?: number }) => s + (l.credit || 0), 0)
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      return Response.json({ error: 'Debits must equal credits' }, { status: 400 })
    }

    const entryDate = date ? new Date(date) : new Date()
    const entryNo = await getNextSequence('JOURNAL', 'OB-')
    const sourceId = randomUUID()

    const entry = await prisma.journalEntry.create({
      data: {
        entryNo,
        date: entryDate,
        description: description ?? 'Opening balances',
        reference: 'OPENING_BALANCE',
        totalDebit,
        totalCredit,
        status: 'POSTED',
        createdById: user.id,
        lines: {
          create: lines.map((l: {
            accountId: string
            debit?: number
            credit?: number
            description?: string
          }) => ({
            accountId: l.accountId,
            description: l.description ?? 'Opening balance',
            debit: l.debit || 0,
            credit: l.credit || 0,
          })),
        },
      },
      include: { lines: true },
    })

    const postingLines: PostingLine[] = lines.map((l: {
      accountId: string
      debit?: number
      credit?: number
      description?: string
    }) => ({
      accountId: l.accountId,
      debit: l.debit || 0,
      credit: l.credit || 0,
      description: l.description ?? 'Opening balance',
    }))

    await postSourceDocumentToLedger({
      companyId,
      sourceType: 'OPENING_BALANCE',
      sourceId,
      entryDate,
      description: description ?? 'Opening balances',
      lines: postingLines,
    })

    await logAudit({
      action: 'POST',
      entityType: 'opening_balance',
      entityId: entry.id,
      userId: user.id,
      companyId,
      details: { entryNo, sourceId },
    })

    return Response.json({ journalEntry: entry, sourceId }, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return Response.json({ error: String(error) }, { status: 500 })
  }
}
