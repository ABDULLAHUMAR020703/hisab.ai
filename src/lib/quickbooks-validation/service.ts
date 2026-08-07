import 'server-only'
import { Provider } from '@/integrations/accounting/contracts/types'
import { createAccountingIntegrationRuntime } from '@/integrations/accounting/services/container'
import { findFirstCompanySettings } from '@/lib/db/settings.repository'
import { getModuleDefinition } from '@/lib/import-export/registry/module-registry'
import { getImportSource } from '@/lib/import-export/sources/source-registry'
import { buildQuickBooksValidationReport, compareQuickBooksModule, VALIDATION_CONFIGS } from './engine'
import type { QuickBooksValidationModule, QuickBooksValidationReport } from './types'
import { validateQuickBooksAccountingMaterialization } from './accounting'

export async function validateQuickBooksImports(
  tenantId: string,
  userId: string,
  selectedModules: QuickBooksValidationModule[],
): Promise<QuickBooksValidationReport> {
  const runtime = createAccountingIntegrationRuntime()
  const provider = runtime.providers.get(Provider.QUICKBOOKS)
  const source = getImportSource('quickbooks')
  const live = await runtime.connections.executeForProvider(tenantId, Provider.QUICKBOOKS, async (context) => {
    const company = await provider.getCompanyInfo(context)
    const resources = []
    for (const resourceKey of selectedModules) resources.push(await source.fetchResource(provider, context, resourceKey))
    return { company, resources, realmId: context.realmId }
  })

  const modules = []
  for (const resource of live.resources) {
    const definition = getModuleDefinition(resource.moduleKey)
    const records = await definition.exportRecords({}, { companyId: tenantId, userId })
    const importedRows = records.map((record) => definition.mapExportRow(record))
    modules.push(compareQuickBooksModule({
      config: VALIDATION_CONFIGS[resource.key as QuickBooksValidationModule],
      sourceRows: resource.rows,
      importedRows,
      realmId: live.realmId,
    }))
  }

  const settings = await findFirstCompanySettings(tenantId)
  const quickBooksCurrency = live.company.baseCurrency?.trim().toUpperCase()
  const hisabCurrency = settings?.currency?.trim().toUpperCase()
  if (modules[0] && quickBooksCurrency && quickBooksCurrency !== hisabCurrency) {
    modules[0].issues.push({
      module: modules[0].module,
      kind: 'mapping_mismatch',
      key: live.realmId,
      recordName: live.company.companyName ?? 'QuickBooks company',
      realmId: live.realmId,
      field: 'currency',
      quickBooksValue: quickBooksCurrency,
      hisabValue: hisabCurrency ?? null,
      message: 'Hisab AI base currency does not match the live QuickBooks company currency.',
    })
    modules[0].mismatchCount += 1
    modules[0].passed = false
  }
  const report=buildQuickBooksValidationReport(live.realmId, modules)
  report.accounting=await validateQuickBooksAccountingMaterialization(tenantId)
  report.passed=report.passed&&report.accounting.passed
  return report
}
