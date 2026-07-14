import { randomUUID } from 'crypto'

export const CORRELATION_HEADER = 'x-correlation-id'

export function createCorrelationId(): string {
  return randomUUID()
}

export function getCorrelationId(request: Request): string {
  return request.headers.get(CORRELATION_HEADER) ?? createCorrelationId()
}
