import 'server-only'

/** When true, read paths run shadow Supabase queries and log diffs (Prisma remains primary). */
export function isParityCheckEnabled(): boolean {
  return process.env.DB_PARITY_CHECK === 'true'
}

/** When true, writes go to Prisma first then Supabase shadow (Phase D5). */
export function isDualWriteEnabled(): boolean {
  return process.env.DUAL_WRITE === 'true'
}

const PARITY_IGNORE_KEYS = new Set([
  'id',
  'legacyId',
  'legacy_id',
  'createdAt',
  'updatedAt',
  'created_at',
  'updated_at',
  'customerId',
  'vendorId',
  'invoiceId',
  'accountId',
  'costCenterId',
  'createdById',
  'employeeId',
  'billId',
  'journalId',
  'payrollId',
  'paymentId',
  'companyId',
  'companySettingsId',
  'userId',
])

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

function normalizeForCompare(value: unknown, key?: string): JsonValue {
  if (key && PARITY_IGNORE_KEYS.has(key)) return null
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map((v) => normalizeForCompare(v))
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const out: Record<string, JsonValue> = {}
    for (const k of Object.keys(obj).sort()) {
      out[k] = normalizeForCompare(obj[k], k)
    }
    return out
  }
  if (typeof value === 'number') return Math.round(value * 10000) / 10000
  return value as JsonValue
}

export function diffParityValues(primary: unknown, shadow: unknown): string[] {
  const a = JSON.stringify(normalizeForCompare(primary))
  const b = JSON.stringify(normalizeForCompare(shadow))
  if (a === b) return []
  return [`primary=${a}`, `shadow=${b}`]
}

export async function withReadParity<T>(
  scope: string,
  primary: () => Promise<T>,
  shadow: () => Promise<T>,
): Promise<T> {
  const result = await primary()

  if (!isParityCheckEnabled()) return result

  try {
    const shadowResult = await shadow()
    const diffs = diffParityValues(result, shadowResult)
    if (diffs.length > 0) {
      console.warn(`[DB parity mismatch] ${scope}`, ...diffs)
    }
  } catch (error) {
    console.warn(`[DB parity error] ${scope}`, error)
  }

  return result
}

export async function withDualWrite<T>(
  scope: string,
  primary: () => Promise<T>,
  shadow: () => Promise<T>,
): Promise<T> {
  const result = await primary()

  if (!isDualWriteEnabled()) return result

  try {
    const shadowResult = await shadow()
    const diffs = diffParityValues(result, shadowResult)
    if (diffs.length > 0) {
      console.warn(`[DB dual-write mismatch] ${scope}`, ...diffs)
    }
  } catch (error) {
    console.warn(`[DB dual-write error] ${scope}`, error)
  }

  return result
}

/** Wraps read-only repository methods with shadow parity checks. */
export function wrapReadParity<T extends object>(
  label: string,
  primary: T,
  shadow: T,
  readMethods: (keyof T)[],
): T {
  if (!isParityCheckEnabled()) return primary

  return new Proxy(primary, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver)
      if (typeof prop !== 'string' || typeof value !== 'function' || !readMethods.includes(prop as keyof T)) {
        return value
      }

      return (...args: unknown[]) =>
        withReadParity(
          `${label}.${prop}`,
          () => (value as (...a: unknown[]) => Promise<unknown>).apply(target, args),
          () =>
            (shadow[prop as keyof T] as (...a: unknown[]) => Promise<unknown>).apply(shadow, args),
        )
    },
  })
}

/** Wraps write methods with dual-write shadow (Phase D5). */
export function wrapDualWrite<T extends object>(
  label: string,
  primary: T,
  shadow: T,
  writeMethods: (keyof T)[],
): T {
  if (!isDualWriteEnabled()) return primary

  return new Proxy(primary, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver)
      if (typeof prop !== 'string' || typeof value !== 'function' || !writeMethods.includes(prop as keyof T)) {
        return value
      }

      return (...args: unknown[]) =>
        withDualWrite(
          `${label}.${prop}`,
          () => (value as (...a: unknown[]) => Promise<unknown>).apply(target, args),
          () =>
            (shadow[prop as keyof T] as (...a: unknown[]) => Promise<unknown>).apply(shadow, args),
        )
    },
  })
}

/** Combine read parity + write dual-write wrappers. */
export function wrapRepository<T extends object>(
  label: string,
  primary: T,
  shadow: T,
  readMethods: (keyof T)[],
  writeMethods: (keyof T)[] = [],
): T {
  let repo: T = primary
  if (isDualWriteEnabled() && writeMethods.length > 0) {
    repo = wrapDualWrite(label, repo, shadow, writeMethods)
  }
  if (isParityCheckEnabled() && readMethods.length > 0) {
    repo = wrapReadParity(label, repo, shadow, readMethods)
  }
  return repo
}
