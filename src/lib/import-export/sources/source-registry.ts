import 'server-only'
import { Provider } from '@/integrations/accounting/contracts/types'
import { createAccountingIntegrationRuntime } from '@/integrations/accounting/services/container'
import { QuickBooksImportAdapter } from './quickbooks.adapter'
import type { ImportSourceAdapter, NormalizedImportResource } from './types'

const adapters = new Map<string, ImportSourceAdapter>([
  ['quickbooks', new QuickBooksImportAdapter()],
])

export function listImportSources() {
  return [...adapters.values()].map(({ key, label, resources }) => ({ key, label, resources }))
}

export function getImportSource(key: string): ImportSourceAdapter {
  const source = adapters.get(key)
  if (!source) throw new Error(`Unknown import source: ${key}`)
  return source
}

export async function fetchSourceResource(
  tenantId: string,
  sourceKey: string,
  resourceKey: string,
): Promise<NormalizedImportResource> {
  const source = getImportSource(sourceKey)
  const runtime = createAccountingIntegrationRuntime()
  const providerSlug = sourceKey as Provider
  const provider = runtime.providers.get(providerSlug)
  return runtime.connections.executeForProvider(tenantId, providerSlug, (context) => (
    source.fetchResource(provider, context, resourceKey)
  ))
}

export async function fetchSourceResources(
  tenantId: string,
  sourceKey: string,
  resourceKeys: string[],
): Promise<NormalizedImportResource[]> {
  const source = getImportSource(sourceKey)
  const runtime = createAccountingIntegrationRuntime()
  const providerSlug = sourceKey as Provider
  const provider = runtime.providers.get(providerSlug)
  return runtime.connections.executeForProvider(tenantId, providerSlug, async (context) => {
    const results: NormalizedImportResource[] = []
    for (const resourceKey of resourceKeys) {
      results.push(await source.fetchResource(provider, context, resourceKey))
    }
    return results
  })
}
