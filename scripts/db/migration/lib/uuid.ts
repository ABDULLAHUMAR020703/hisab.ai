import { createHash } from 'node:crypto'
import { MIGRATION_NAMESPACE, COMPANY_ID } from './constants'

/** RFC 4122 UUID v5 */
export function uuidv5(name: string, namespaceUuid: string): string {
  const namespaceBytes = uuidToBytes(namespaceUuid)
  const hash = createHash('sha1')
    .update(namespaceBytes)
    .update(name, 'utf8')
    .digest()

  const bytes = Buffer.from(hash.subarray(0, 16))
  bytes[6] = (bytes[6]! & 0x0f) | 0x50
  bytes[8] = (bytes[8]! & 0x3f) | 0x80

  return bytesToUuid(bytes)
}

function uuidToBytes(uuid: string): Buffer {
  const hex = uuid.replace(/-/g, '')
  return Buffer.from(hex, 'hex')
}

function bytesToUuid(bytes: Buffer): string {
  const hex = bytes.toString('hex')
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-')
}

/** Deterministic Supabase primary key from Prisma cuid */
export function deterministicId(entityType: string, legacyId: string): string {
  if (entityType === 'CompanySettings') {
    return COMPANY_ID
  }
  return uuidv5(`hisab:${entityType}:${legacyId}`, MIGRATION_NAMESPACE)
}
