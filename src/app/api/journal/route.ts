import { requireAuth } from '@/lib/auth'
import { toCamel } from '@/lib/api/db-transform'
import { prisma } from '@/lib/prisma'
import { getNextSequence } from '@/lib/sequences'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCompanyId } from '@/lib/tenant'
import { maybeStartWorkflow } from '@/lib/workflow/integration'

/**
 * List journals the same way Recent Activity does: tenant-scoped + soft-delete aware.
 * The Prisma shim's findMany does not implement AND/OR and does not inject company_id,
 * so the previous listing query failed and the page silently showed an empty list.
 */
export async function GET(request: Request) {
  try {
    await requireAuth()
    const companyId = await resolveCompanyId()
    const { searchParams } = new URL(request.url)
    const search = (searchParams.get('search') ?? '').trim()
    const status = (searchParams.get('status') ?? '').trim()
    const client = createAdminClient()

    let query = client
      .from('journal_entries')
      .select(`
        *,
        created_by:profiles!created_by_id(full_name),
        lines:journal_lines(
          *,
          account:chart_of_accounts(*),
          cost_center:cost_centers(*)
        )
      `)
      .eq('company_id', companyId)
      .is('deleted_at', null)
      .order('date', { ascending: false })

    if (status) query = query.eq('status', status)
    if (search) {
      // Strip PostgREST or()-filter metacharacters so user input cannot break the filter.
      const safe = search.replace(/[%_,.()]/g, ' ').replace(/\s+/g, ' ').trim()
      if (safe) {
        query = query.or(`entry_no.ilike.%${safe}%,description.ilike.%${safe}%`)
      }
    }

    const { data, error } = await query
    if (error) throw error

    const entries = (toCamel(data ?? []) as Array<Record<string, unknown>>).map((row) => {
      const createdBy = row.createdBy as { fullName?: string; name?: string } | null | undefined
      return {
        ...row,
        createdBy: { name: createdBy?.name ?? createdBy?.fullName ?? '' },
      }
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
