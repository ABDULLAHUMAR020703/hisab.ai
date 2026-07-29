import type { IntegrationRepository } from '../contracts/repositories'
import { logger } from '@/lib/ops/logger'

const SENSITIVE_KEY = /(token|secret|authorization|credential|oauth.?state|auth.?code)/i

function redactMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactMetadata)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
    key,
    SENSITIVE_KEY.test(key) ? '[REDACTED]' : redactMetadata(item),
  ]))
}

export class AuditLogService {
  constructor(private readonly repository: IntegrationRepository) {}

  async record(input: {
    connectionId: string
    action: string
    status: string
    message?: string | null
    metadata?: Record<string, unknown>
  }): Promise<void> {
    const metadata = redactMetadata(input.metadata ?? {}) as Record<string, unknown>
    await this.repository.createLog({
      connectionId: input.connectionId,
      action: input.action,
      status: input.status,
      message: input.message ?? null,
      metadata,
    })
    const log = input.status === 'FAILED' || input.action.endsWith('FAILED') ? logger.error : logger.info
    log('accounting.integration.audit', {
      connectionId: input.connectionId,
      action: input.action,
      status: input.status,
      ...metadata,
    })
  }
}
