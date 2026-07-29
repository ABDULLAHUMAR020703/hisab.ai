import { createHash, randomBytes } from 'node:crypto'
import type { IntegrationRepository } from '../contracts/repositories'
import type { IntegrationOAuthStateRecord } from '../contracts/types'
import {
  ExpiredOAuthStateException,
  InvalidOAuthStateException,
  ReusedOAuthStateException,
  UnauthorizedIntegrationException,
} from '../utils/exceptions'

const DEFAULT_TTL_MS = 10 * 60 * 1000

export function hashOAuthState(state: string): string {
  return createHash('sha256').update(state, 'utf8').digest('hex')
}

export class OAuthStateService {
  constructor(
    private readonly repository: IntegrationRepository,
    private readonly now: () => Date = () => new Date(),
    private readonly ttlMs = DEFAULT_TTL_MS,
  ) {}

  async create(input: {
    tenantId: string
    providerId: string
    connectionId: string
    userId: string
  }): Promise<string> {
    const state = randomBytes(32).toString('base64url')
    const createdAt = this.now()
    await this.repository.createOAuthState({
      stateHash: hashOAuthState(state),
      tenantId: input.tenantId,
      providerId: input.providerId,
      connectionId: input.connectionId,
      createdBy: input.userId,
      expiresAt: new Date(createdAt.getTime() + this.ttlMs),
    })
    return state
  }

  async consume(input: {
    state: string
    tenantId: string
    providerId: string
    userId: string
  }): Promise<IntegrationOAuthStateRecord> {
    if (!input.state || input.state.length > 256) throw new InvalidOAuthStateException()
    const record = await this.repository.findOAuthState(hashOAuthState(input.state))
    if (!record) throw new InvalidOAuthStateException()
    const now = this.now()
    if (record.consumedAt) throw new ReusedOAuthStateException()
    if (record.expiresAt.getTime() <= now.getTime()) throw new ExpiredOAuthStateException()
    if (record.tenantId !== input.tenantId || record.providerId !== input.providerId || record.createdBy !== input.userId) {
      throw new UnauthorizedIntegrationException('OAuth state does not belong to the active company and user.')
    }
    const consumed = await this.repository.consumeOAuthState(record.id, now)
    if (!consumed) throw new ReusedOAuthStateException()
    return consumed
  }
}
