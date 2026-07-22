import type { Finding, GoLiveSelection, PreviewPlan, ReadinessAnalysis } from '../types'

export function buildPreviewPlan(
  analysis: ReadinessAnalysis,
  selection: GoLiveSelection,
): PreviewPlan {
  const byId = new Map<string, Finding>(analysis.findings.map((f) => [f.entityId, f]))
  const blockers: string[] = []

  if (analysis.blocked.length > 0) {
    blockers.push(
      ...analysis.blocked.map((b) => `Required: ${b.label} — ${b.message}`),
    )
  }

  function collect(
    ids: string[],
    entityType: string,
    action: 'archive' | 'soft_delete',
  ) {
    const labels: string[] = []
    const safeIds: string[] = []
    for (const id of ids) {
      const f = byId.get(id)
      if (!f) {
        blockers.push(`${entityType} ${id} was not in the analysis findings.`)
        continue
      }
      if (f.risk === 'PROTECTED' || !f.canAct) {
        blockers.push(`${f.label} is protected or cannot be acted on.`)
        continue
      }
      if (action === 'archive' && f.suggestedAction !== 'archive' && f.entityType === 'invoice') {
        blockers.push(`${f.label} cannot be archived as an invoice.`)
        continue
      }
      safeIds.push(id)
      labels.push(f.label)
    }
    return { entityType, ids: safeIds, labels }
  }

  const softDelete = [
    collect(selection.softDeleteInvoiceIds, 'invoice', 'soft_delete'),
  ].filter((g) => g.ids.length > 0)

  const archive = [
    collect(selection.archiveCustomerIds, 'customer', 'archive'),
    collect(selection.archiveVendorIds, 'vendor', 'archive'),
    collect(selection.archiveProductIds, 'product', 'archive'),
    collect(selection.archiveCostCenterIds, 'cost_center', 'archive'),
  ].filter((g) => g.ids.length > 0)

  const keep = [
    {
      label: 'Protected invoices',
      count: analysis.protectedSummary.invoices ?? 0,
    },
    { label: 'ZATCA credentials & certificates', count: 1 },
    { label: 'Company profile', count: 1 },
  ]

  return {
    archive,
    softDelete,
    keep,
    untouched: [
      'ZATCA credentials',
      'CSIDs and private keys',
      'Protected invoice UUID/hash/submission history',
      'Chart of accounts structure',
      'Audit logs',
    ],
    numbering: selection.numbering ?? null,
    blockedRemaining: analysis.blocked,
    zatcaCredentialsUnchanged: true,
    canExecute: blockers.length === 0 && analysis.blocked.length === 0,
    blockers,
  }
}
