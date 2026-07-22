import { DEFAULT_READINESS_MODULES } from '../constants'

export function resolveApplicableModules(
  stored: Record<string, unknown> | null | undefined,
  zatcaEnabled: boolean,
): string[] {
  const merged = { ...DEFAULT_READINESS_MODULES, ...(stored ?? {}) }
  if (!zatcaEnabled) merged.zatca = false
  return Object.entries(merged)
    .filter(([, enabled]) => Boolean(enabled))
    .map(([key]) => key)
}

export function isModuleApplicable(applicable: string[], moduleKey: string): boolean {
  return applicable.includes(moduleKey)
}
