import type { HealthCheck, HealthFinding, HealthScanContext } from './types'

async function findDuplicateNames(
  ctx: HealthScanContext,
  table: string,
  entityType: string,
  checkId: string,
): Promise<HealthFinding[]> {
  const { data } = await ctx.db
    .from(table)
    .select('id, name')
    .eq('company_id', ctx.companyId)
    .is('deleted_at', null)
    .limit(1000)

  const byName = new Map<string, string[]>()
  for (const row of data ?? []) {
    const key = String(row.name ?? '')
      .trim()
      .toLowerCase()
    if (!key) continue
    const list = byName.get(key) ?? []
    list.push(String(row.id))
    byName.set(key, list)
  }

  const findings: HealthFinding[] = []
  for (const [name, ids] of byName) {
    if (ids.length < 2) continue
    findings.push({
      checkId,
      severity: 'high',
      entityType,
      entityId: ids[0],
      title: `Duplicate ${entityType}: ${name}`,
      detail: `${ids.length} records share the same name.`,
      recommendation: 'Merge or archive duplicates after verifying references.',
      confidence: 90,
    })
  }
  return findings
}

export const HEALTH_CHECKS: HealthCheck[] = [
  {
    id: 'dup.customer.name',
    category: 'master_data',
    severity: 'high',
    description: 'Detect duplicate customers by name',
    moduleKey: 'sales',
    versionAdded: 'v1.0',
    autoFixCapable: false,
    detect: (ctx) => findDuplicateNames(ctx, 'customers', 'customer', 'dup.customer.name'),
  },
  {
    id: 'dup.vendor.name',
    category: 'master_data',
    severity: 'high',
    description: 'Detect duplicate vendors by name',
    moduleKey: 'purchasing',
    versionAdded: 'v1.0',
    autoFixCapable: false,
    detect: (ctx) => findDuplicateNames(ctx, 'vendors', 'vendor', 'dup.vendor.name'),
  },
  {
    id: 'invoice.failed',
    category: 'sales',
    severity: 'high',
    description: 'Failed ZATCA invoice submissions',
    moduleKey: 'sales',
    versionAdded: 'v1.0',
    autoFixCapable: false,
    async detect(ctx) {
      const { data } = await ctx.db
        .from('invoices')
        .select('id, invoice_no, zatca_status')
        .eq('company_id', ctx.companyId)
        .eq('zatca_status', 'FAILED')
        .is('deleted_at', null)
        .limit(100)
      return (data ?? []).map((row) => ({
        checkId: 'invoice.failed',
        severity: 'high' as const,
        entityType: 'invoice',
        entityId: String(row.id),
        title: `Failed invoice ${row.invoice_no}`,
        detail: 'ZATCA status is FAILED.',
        recommendation: 'Review submission errors and resubmit or void as appropriate.',
        confidence: 100,
      }))
    },
  },
  {
    id: 'zatca.missing_uuid',
    category: 'zatca',
    severity: 'critical',
    description: 'Submitted invoices missing UUID',
    moduleKey: 'zatca',
    versionAdded: 'v1.0',
    autoFixCapable: false,
    async detect(ctx) {
      const { data } = await ctx.db
        .from('invoices')
        .select('id, invoice_no, zatca_status, invoice_uuid')
        .eq('company_id', ctx.companyId)
        .in('zatca_status', ['SUBMITTED', 'CLEARED', 'REPORTED'])
        .is('deleted_at', null)
        .limit(200)
      return (data ?? [])
        .filter((row) => !row.invoice_uuid)
        .map((row) => ({
          checkId: 'zatca.missing_uuid',
          severity: 'critical' as const,
          entityType: 'invoice',
          entityId: String(row.id),
          title: `Missing UUID on ${row.invoice_no}`,
          detail: `Status ${row.zatca_status} but invoice_uuid is empty.`,
          recommendation: 'Investigate ZATCA submission payload — do not delete the invoice.',
          confidence: 100,
        }))
    },
  },
  {
    id: 'numbering.corrupt_next',
    category: 'document_numbering',
    severity: 'critical',
    description: 'Implausible document sequence next numbers',
    moduleKey: 'document_numbering',
    versionAdded: 'v1.0',
    autoFixCapable: false,
    async detect(ctx) {
      const { data } = await ctx.db
        .from('document_sequences')
        .select('document_type, prefix, next_number')
        .eq('company_id', ctx.companyId)
      return (data ?? [])
        .filter((row) => Number(row.next_number) > 999_999_999)
        .map((row) => ({
          checkId: 'numbering.corrupt_next',
          severity: 'critical' as const,
          entityType: 'document_sequence',
          title: `Corrupt next number for ${row.document_type}`,
          detail: `next_number=${row.next_number} with prefix ${row.prefix}`,
          recommendation: 'Repair document numbering in Settings → Document Numbering.',
          confidence: 100,
        }))
    },
  },
  {
    id: 'accounting.unbalanced_journals',
    category: 'accounting',
    severity: 'critical',
    description: 'Posted journals that do not balance',
    moduleKey: 'accounting',
    versionAdded: 'v1.0',
    autoFixCapable: false,
    async detect(ctx) {
      const { data: journals } = await ctx.db
        .from('journal_entries')
        .select('id, entry_no, status')
        .eq('company_id', ctx.companyId)
        .eq('status', 'POSTED')
        .is('deleted_at', null)
        .limit(100)

      const findings: HealthFinding[] = []
      for (const je of journals ?? []) {
        const { data: lines } = await ctx.db
          .from('journal_lines')
          .select('debit, credit')
          .eq('company_id', ctx.companyId)
          .eq('journal_id', je.id)
        const debit = (lines ?? []).reduce((s, l) => s + Number(l.debit ?? 0), 0)
        const credit = (lines ?? []).reduce((s, l) => s + Number(l.credit ?? 0), 0)
        if (Math.abs(debit - credit) > 0.02) {
          findings.push({
            checkId: 'accounting.unbalanced_journals',
            severity: 'critical',
            entityType: 'journal_entry',
            entityId: String(je.id),
            title: `Unbalanced journal ${je.entry_no ?? je.id}`,
            detail: `Debit ${debit.toFixed(2)} vs Credit ${credit.toFixed(2)}`,
            recommendation: 'Correct journal lines before relying on financial reports.',
            confidence: 100,
          })
        }
      }
      return findings
    },
  },
  {
    id: 'master.customer.missing_vat',
    category: 'master_data',
    severity: 'medium',
    description: 'Customers missing tax ID',
    moduleKey: 'sales',
    versionAdded: 'v1.0',
    autoFixCapable: false,
    async detect(ctx) {
      const { data } = await ctx.db
        .from('customers')
        .select('id, name, tax_id')
        .eq('company_id', ctx.companyId)
        .is('deleted_at', null)
        .is('archived_at', null)
        .limit(300)
      return (data ?? [])
        .filter((row) => !String(row.tax_id ?? '').trim())
        .slice(0, 50)
        .map((row) => ({
          checkId: 'master.customer.missing_vat',
          severity: 'medium' as const,
          entityType: 'customer',
          entityId: String(row.id),
          title: `Missing VAT on ${row.name}`,
          detail: 'Customer has no tax_id.',
          recommendation: 'Add VAT/TRN for B2B customers used on standard invoices.',
          confidence: 80,
        }))
    },
  },
  {
    id: 'inventory.negative_stock',
    category: 'inventory',
    severity: 'high',
    description: 'Inventory items with negative quantity',
    moduleKey: 'inventory',
    versionAdded: 'v1.0',
    autoFixCapable: false,
    async detect(ctx) {
      if (!ctx.applicableModules.includes('inventory')) return []
      const { data } = await ctx.db
        .from('inventory_items')
        .select('id, name, quantity')
        .eq('company_id', ctx.companyId)
        .is('deleted_at', null)
        .lt('quantity', 0)
        .limit(100)
      return (data ?? []).map((row) => ({
        checkId: 'inventory.negative_stock',
        severity: 'high' as const,
        entityType: 'product',
        entityId: String(row.id),
        title: `Negative stock: ${row.name}`,
        detail: `quantity=${row.quantity}`,
        recommendation: 'Investigate stock movements and correct inventory.',
        confidence: 100,
      }))
    },
  },
]
