import type { ImportRowError, SkippedRecordDiagnostic } from './types'

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
  errors?: ImportRowError[]
  skipSummary?: Record<string, number>
  skippedRecords?: SkippedRecordDiagnostic[]
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
  const totals = input.modules.reduce((total, moduleReport) => ({
    sourceCount: total.sourceCount + moduleReport.sourceCount,
    validCount: total.validCount + moduleReport.validCount,
    warnings: total.warnings + moduleReport.warningCount,
    failures: total.failures + moduleReport.failedCount + moduleReport.validationErrors,
    imported: total.imported + moduleReport.importedCount,
    updated: total.updated + moduleReport.updatedCount,
    skipped: total.skipped + moduleReport.skippedCount,
  }), { sourceCount: 0, validCount: 0, warnings: 0, failures: 0, imported: 0, updated: 0, skipped: 0 })
  const validationScore = totals.sourceCount ? Math.round((totals.validCount / totals.sourceCount) * 10000) / 100 : 100
  const processed = totals.imported + totals.updated + totals.skipped
  const integrityScore = totals.sourceCount ? Math.max(0, Math.round(((processed - totals.failures) / totals.sourceCount) * 10000) / 100) : 100
  return { ...input, reportVersion: 1, generatedAt: new Date().toISOString(), totals, validationScore, integrityScore }
}

export function migrationReportToCsv(report: MigrationReport): string {
  const rows = [['Module', 'Source records', 'Valid', 'Warnings', 'Validation errors', 'Imported', 'Updated', 'Skipped', 'Failed', 'Duration (ms)'], ...report.modules.map((moduleReport) => [moduleReport.label, moduleReport.sourceCount, moduleReport.validCount, moduleReport.warningCount, moduleReport.validationErrors, moduleReport.importedCount, moduleReport.updatedCount, moduleReport.skippedCount, moduleReport.failedCount, moduleReport.durationMs])]
  rows.push(['TOTAL', report.totals.sourceCount, report.totals.validCount, report.totals.warnings, report.totals.failures, report.totals.imported, report.totals.updated, report.totals.skipped, report.totals.failures, report.durationMs])
  rows.push(['Validation score', `${report.validationScore}%`, '', '', '', '', '', '', '', ''])
  rows.push(['Integrity score', `${report.integrityScore}%`, '', '', '', '', '', '', '', ''])
  for (const moduleReport of report.modules) for (const [reason, count] of Object.entries(moduleReport.skipSummary ?? {})) rows.push([`${moduleReport.label} skip reason`, reason, count, '', '', '', '', '', '', ''])
  for (const moduleReport of report.modules) for (const skipped of moduleReport.skippedRecords ?? []) rows.push([`${moduleReport.label} skipped record`, skipped.sourceId ?? '', skipped.recordName ?? '', skipped.reason, skipped.existingRecordId ?? '', skipped.duplicateKey ?? '', '', '', '', ''])
  for(const moduleReport of report.modules)for(const error of moduleReport.errors??[])rows.push([`${moduleReport.label} error`,error.rowNumber,error.details?.status??'',error.errorCode,error.message,error.details?.dependency??'',error.details?.constraint??'',error.details?.table??'',error.details?.column??'',''])
  return rows.map((row) => row.map((value) => { const text = String(value ?? ''); return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text }).join(',')).join('\r\n')
}
