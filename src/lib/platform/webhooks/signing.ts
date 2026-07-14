import { createHmac, randomBytes, createHash } from 'crypto'

export function generateWebhookSecret(): string {
  return randomBytes(32).toString('hex')
}

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex')
}

export function signPayload(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex')
}
