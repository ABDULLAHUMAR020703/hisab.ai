import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCompanyId } from '@/lib/tenant'
import { prisma } from '@/lib/prisma'

export interface SearchResult {
  entityType: string
  entityId: string
  title: string
  subtitle?: string
  url?: string
  score: number
}

export async function globalSearch(query: string, options?: {
  companyId?: string
  userId?: string
  entityTypes?: string[]
  limit?: number
}) {
  const companyId = options?.companyId ?? await resolveCompanyId()
  const q = query.trim()
  if (!q || q.length < 2) return { results: [], query: q }

  const limit = options?.limit ?? 20
  const types = options?.entityTypes ?? ['customers', 'vendors', 'invoices', 'bills', 'products', 'journal_entries', 'documents', 'employees', 'accounts']
  const pattern = `%${q}%`
  const results: SearchResult[] = []

  if (types.includes('customers')) {
    const rows = await prisma.customer.findMany({
      where: { OR: [{ name: { contains: q } }, { email: { contains: q } }] },
      take: 5,
      select: { id: true, name: true, email: true },
    })
    for (const r of rows) {
      results.push({ entityType: 'customer', entityId: r.id, title: r.name, subtitle: r.email ?? '', url: `/customers`, score: 10 })
    }
  }

  if (types.includes('vendors')) {
    const rows = await prisma.vendor.findMany({
      where: { OR: [{ name: { contains: q } }, { email: { contains: q } }] },
      take: 5,
      select: { id: true, name: true, email: true },
    })
    for (const r of rows) {
      results.push({ entityType: 'vendor', entityId: r.id, title: r.name, subtitle: r.email ?? '', url: `/vendors`, score: 10 })
    }
  }

  if (types.includes('invoices')) {
    const rows = await prisma.invoice.findMany({
      where: { invoiceNo: { contains: q } },
      take: 5,
      select: { id: true, invoiceNo: true, total: true },
    })
    for (const r of rows) {
      results.push({ entityType: 'invoice', entityId: r.id, title: r.invoiceNo, subtitle: String(r.total), url: `/invoices`, score: 9 })
    }
  }

  if (types.includes('bills')) {
    const rows = await prisma.bill.findMany({
      where: { billNo: { contains: q } },
      take: 5,
      select: { id: true, billNo: true, total: true },
    })
    for (const r of rows) {
      results.push({ entityType: 'bill', entityId: r.id, title: r.billNo, subtitle: String(r.total), url: `/bills`, score: 9 })
    }
  }

  const client = createAdminClient()

  if (types.includes('documents')) {
    const { data: docs } = await client
      .from('documents')
      .select('id, file_name, entity_type, entity_id')
      .eq('company_id', companyId)
      .ilike('file_name', pattern)
      .limit(5)
    for (const d of docs ?? []) {
      results.push({
        entityType: 'document',
        entityId: d.id,
        title: d.file_name,
        subtitle: d.entity_type,
        score: 7,
      })
    }
  }

  if (types.includes('employees')) {
    const rows = await prisma.employee.findMany({
      where: { name: { contains: q } },
      take: 5,
      select: { id: true, name: true, employeeNo: true },
    })
    for (const r of rows) {
      results.push({ entityType: 'employee', entityId: r.id, title: r.name, subtitle: r.employeeNo, url: `/employees`, score: 8 })
    }
  }

  if (types.includes('journal_entries')) {
    const rows = await prisma.journalEntry.findMany({
      where: { OR: [{ entryNo: { contains: q } }, { description: { contains: q } }] },
      take: 5,
      select: { id: true, entryNo: true, description: true },
    })
    for (const r of rows) {
      results.push({ entityType: 'journal_entry', entityId: r.id, title: r.entryNo, subtitle: r.description ?? '', url: `/journal`, score: 8 })
    }
  }

  if (types.includes('accounts')) {
    const { data: accounts } = await client
      .from('chart_of_accounts')
      .select('id, account_no, name')
      .eq('company_id', companyId)
      .or(`account_no.ilike.${pattern},name.ilike.${pattern}`)
      .limit(5)
    for (const a of accounts ?? []) {
      results.push({
        entityType: 'account',
        entityId: a.id,
        title: `${a.account_no} — ${a.name}`,
        url: `/accounts`,
        score: 6,
      })
    }
  }

  if (types.includes('products')) {
    const { data: items } = await client
      .from('inventory_items')
      .select('id, item_code, name')
      .eq('company_id', companyId)
      .or(`item_code.ilike.${pattern},name.ilike.${pattern}`)
      .limit(5)
    for (const i of items ?? []) {
      results.push({
        entityType: 'product',
        entityId: i.id,
        title: `${i.item_code} — ${i.name}`,
        url: `/inventory`,
        score: 7,
      })
    }
  }

  results.sort((a, b) => b.score - a.score)

  if (options?.userId) {
    await client.from('search_recent').insert({
      company_id: companyId,
      user_id: options.userId,
      query: q,
    })
  }

  return { query: q, results: results.slice(0, limit) }
}

export async function getRecentSearches(userId: string, companyId?: string, limit = 10) {
  const cid = companyId ?? await resolveCompanyId()
  const client = createAdminClient()
  const { data } = await client
    .from('search_recent')
    .select('query, entity_type, created_at')
    .eq('company_id', cid)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit)
  return data ?? []
}
