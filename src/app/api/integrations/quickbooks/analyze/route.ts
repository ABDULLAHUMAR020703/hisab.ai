import { Provider } from '@/integrations/accounting/contracts/types'
import { integrationApiHandler } from '@/integrations/accounting/middlewares/api-handler'
import { IntegrationPermission } from '@/integrations/accounting/middlewares/permissions'
import { createAccountingIntegrationRuntime } from '@/integrations/accounting/services/container'
import { getImportSource } from '@/lib/import-export/sources/source-registry'
import { QUICKBOOKS_ENTITY_BY_RESOURCE } from '@/lib/import-export/sources/quickbooks.adapter'

export const GET = integrationApiHandler(
  'GET /api/integrations/quickbooks/analyze',
  IntegrationPermission.VIEW,
  async ({ tenantId }) => {
    const runtime = createAccountingIntegrationRuntime()
    const source = getImportSource('quickbooks')
    const analysis = await runtime.connections.executeForProvider(tenantId, Provider.QUICKBOOKS, async (context) => {
      const provider = runtime.providers.get(Provider.QUICKBOOKS)
      const company = await provider.getCompanyInfo(context)
      const modules = []
      for (const resource of source.resources) {
        try {
          const entity=QUICKBOOKS_ENTITY_BY_RESOURCE[resource.key]
          const count=resource.key==='preferences'?1:provider.getEntityCount&&entity?await provider.getEntityCount(context,entity):(await source.fetchResource(provider,context,resource.key)).rows.length
          modules.push({ key: resource.key, label: resource.label, count, supported: true, reason:null })
        } catch (error) {
          modules.push({ key:resource.key, label:resource.label, count:0, supported:false, reason:error instanceof Error ? error.message : 'QuickBooks did not make this module available.' })
        }
      }
      return { company, realmId: context.realmId, modules }
    })

    const supportedCount = analysis.modules.filter(module => module.supported).length
    const coverageTotal = analysis.modules.length
    const recordCount = analysis.modules.reduce((sum, module) => sum + module.count, 0)
    return Response.json({
      companyName: analysis.company.companyName,
      fiscalYear: analysis.company.fiscalYear ?? null,
      country: analysis.company.country,
      currency: analysis.company.baseCurrency,
      realmId: analysis.realmId,
      recordCounts: analysis.modules,
      estimatedMigrationMinutes: Math.max(1, Math.ceil(recordCount / 500)),
      supportedModules: analysis.modules.filter(module => module.supported).map((module) => module.label),
      unsupportedModules: analysis.modules.filter(module => !module.supported).map(module => module.label),
      unsupportedModuleDetails: analysis.modules.filter(module => !module.supported).map(module => ({ label:module.label, reason:module.reason })),
      migrationCoveragePercent: Math.round((supportedCount / coverageTotal) * 100),
    }, { headers: { 'Cache-Control': 'no-store' } })
  },
)
