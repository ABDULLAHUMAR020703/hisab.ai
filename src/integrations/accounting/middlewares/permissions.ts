import { UnauthorizedIntegrationException } from '../utils/exceptions'

export const IntegrationPermission = {
  VIEW: 'integration.view',
  CONNECT: 'integration.connect',
  DISCONNECT: 'integration.disconnect',
  MANAGE: 'integration.manage',
} as const

export type IntegrationPermission = (typeof IntegrationPermission)[keyof typeof IntegrationPermission]

const VIEW_ONLY = new Set<IntegrationPermission>([IntegrationPermission.VIEW])
const MANAGER = new Set<IntegrationPermission>(Object.values(IntegrationPermission))

const ROLE_PERMISSIONS: Record<string, ReadonlySet<IntegrationPermission>> = {
  OWNER: MANAGER,
  ADMIN: MANAGER,
  ACCOUNTANT: VIEW_ONLY,
  MANAGER: VIEW_ONLY,
  EMPLOYEE: VIEW_ONLY,
  AUDITOR: VIEW_ONLY,
}

export function hasIntegrationPermission(role: string, permission: IntegrationPermission): boolean {
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false
}

export function assertIntegrationPermission(role: string, permission: IntegrationPermission): void {
  if (!hasIntegrationPermission(role, permission)) {
    throw new UnauthorizedIntegrationException(`Missing permission: ${permission}`)
  }
}
