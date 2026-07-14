import { isRegisteredModule } from '@/lib/import-export/registry/module-registry'
import { FrameworkNotFoundError } from '@/lib/import-export/errors'

export function resolveModuleParam(moduleKey: string): string {
  if (!isRegisteredModule(moduleKey)) {
    throw new FrameworkNotFoundError(`Unknown module: ${moduleKey}`)
  }
  return moduleKey
}

export function filtersFromSearchParams(searchParams: URLSearchParams): Record<string, string> {
  const filters: Record<string, string> = {}
  for (const [key, value] of searchParams.entries()) {
    if (['format', 'module'].includes(key)) continue
    filters[key] = value
  }
  return filters
}
