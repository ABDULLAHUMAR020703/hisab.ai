export interface MigrationReportModule {
  key: string
  label: string
  sourceCount: number
  validCount: number
  warningCount: number
  validationErrors: number
  importedCount: number
  updatedCount: number
  skippedCount: number
  failedCount: number
  durationMs: number
}

export interface MigrationReport {
  reportVersion: 1
  generatedAt: string
  source: string
  companyName?: string | null
  currency?: string | null
  durationMs: number
  modules: MigrationReportModule[]
  totals: { sourceCount: number; validCount: number; warnings: number; failures: number; imported: number; updated: number; skipped: number }
  validationScore: number
  integrityScore: number
}

export function buildMigrationReport(input: Omit<MigrationReport, 'reportVersion' | 'generatedAt' | 'totals' | 'validationScore' | 'integrityScore'>): MigrationReport {
  const totals = input.modules.reduce((total, module) => ({
    sourceCount: total.sourceCount + module.sourceCount,
    validCount: total.validCount + module.validCount,
    warnings: total.warnings + module.warningCount,
    failures: total.failures + module.failedCount + module.validationErrors,
    imported: total.imported + module.importedCount,
    updated: total.updated + module.updatedCount,
    skipped: total.skipped + module.skippedCount,
  }), { sourceCount: 0, validCount: 0, warnings: 0, failures: 0, imported: 0, updated: 0, skipped: 0 })
  const validationScore = totals.sourceCount ? Math.round((totals.validCount / totals.sourceCount) * 10000) / 100 : 100
  const processed = totals.imported + totals.updated + totals.skipped
  const integrityScore = totals.sourceCount ? Math.max(0, Math.round(((processed - totals.failures) / totals.sourceCount) * 10000) / 100) : 100
  return { ...input, reportVersion: 1, generatedAt: new Date().toISOString(), totals, validationScore, integrityScore }
}

export function migrationReportToCsv(report: MigrationReport): string {
  const rows = [['Module', 'Source records', 'Valid', 'Warnings', 'Validation errors', 'Imported', 'Updated', 'Skipped', 'Failed', 'Duration (ms)'], ...report.modules.map((module) => [module.label, module.sourceCount, module.validCount, module.warningCount, module.validationErrors, module.importedCount, module.updatedCount, module.skippedCount, module.failedCount, module.durationMs])]
  rows.push(['TOTAL', report.totals.sourceCount, report.totals.validCount, report.totals.warnings, report.totals.failures, report.totals.imported, report.totals.updated, report.totals.skipped, report.totals.failures, report.durationMs])
  rows.push(['Validation score', `${report.validationScore}%`, '', '', '', '', '', '', '', ''])
  rows.push(['Integrity score', `${report.integrityScore}%`, '', '', '', '', '', '', '', ''])
  return rows.map((row) => row.map((value) => { const text = String(value ?? ''); return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text }).join(',')).join('\r\n')
}
