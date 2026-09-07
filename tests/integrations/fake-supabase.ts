/**
 * A small in-memory stand-in for the Supabase service-role client, faithful
 * enough for the QuickBooks snapshot lifecycle (snapshot + checkpoint + read
 * cursor tables, job_queue, and the private storage bucket).
 *
 * Not a test file — imported by the snapshot integration test.
 */
import { randomUUID } from 'node:crypto'

type Row = Record<string, unknown>

interface Result {
  data: unknown
  error: { message: string; code?: string } | null
}

/** A partial unique index: rows where `where` holds must have a unique `key`. */
export interface FakeUniqueIndex {
  table: string
  where: (row: Row) => boolean
  key: (row: Row) => string
}

class FakeQuery implements PromiseLike<Result> {
  private filters: Array<[string, string, unknown]> = []
  private orderBy: { column: string; ascending: boolean } | null = null
  private limitN: number | null = null
  private selecting = false
  private mode: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select'
  private payload: Row | Row[] | null = null
  private onConflict: string[] = []
  private singleRow = false
  private maybe = false

  constructor(
    private readonly store: Map<string, Row[]>,
    private readonly table: string,
    private readonly indexes: FakeUniqueIndex[] = [],
  ) {}

  private violatesUniqueIndex(candidate: Row, ignore?: Row): { message: string } | null {
    for (const idx of this.indexes) {
      if (idx.table !== this.table || !idx.where(candidate)) continue
      const key = idx.key(candidate)
      const clash = this.rows().some((row) => row !== ignore && idx.where(row) && idx.key(row) === key)
      if (clash) return { message: `duplicate key value violates unique index on ${this.table} (${key})` }
    }
    return null
  }

  private rows(): Row[] {
    if (!this.store.has(this.table)) this.store.set(this.table, [])
    return this.store.get(this.table)!
  }

  select() { this.selecting = true; return this }
  eq(column: string, value: unknown) { this.filters.push([column, 'eq', value]); return this }
  neq(column: string, value: unknown) { this.filters.push([column, 'neq', value]); return this }
  lt(column: string, value: unknown) { this.filters.push([column, 'lt', value]); return this }
  lte(column: string, value: unknown) { this.filters.push([column, 'lte', value]); return this }
  gt(column: string, value: unknown) { this.filters.push([column, 'gt', value]); return this }
  gte(column: string, value: unknown) { this.filters.push([column, 'gte', value]); return this }
  contains(column: string, value: Record<string, unknown>) { this.filters.push([column, 'contains', value]); return this }
  is(column: string, value: unknown) { this.filters.push([column, 'is', value]); return this }
  in(column: string, values: unknown[]) { this.filters.push([column, 'in', values]); return this }
  not(column: string, _op: string, value: unknown) { this.filters.push([column, 'not', value]); return this }
  filter(expr: string, _op: string, value: unknown) {
    // Supports `payload->>key`.
    const m = /^([a-z_]+)->>([a-zA-Z0-9_]+)$/.exec(expr)
    this.filters.push([m ? `__json:${m[1]}.${m[2]}` : expr, 'eq', value])
    return this
  }
  order(column: string, opts?: { ascending?: boolean }) { this.orderBy = { column, ascending: opts?.ascending ?? true }; return this }
  limit(n: number) { this.limitN = n; return this }
  range() { return this }
  abortSignal() { return this }
  maybeSingle() { this.maybe = true; return this }
  single() { this.singleRow = true; return this }

  insert(payload: Row | Row[]) { this.mode = 'insert'; this.payload = payload; return this }
  update(payload: Row) { this.mode = 'update'; this.payload = payload; return this }
  upsert(payload: Row | Row[], opts?: { onConflict?: string }) {
    this.mode = 'upsert'
    this.payload = payload
    this.onConflict = opts?.onConflict ? opts.onConflict.split(',').map((s) => s.trim()) : []
    return this
  }
  delete() { this.mode = 'delete'; return this }

  private matches(row: Row): boolean {
    return this.filters.every(([column, op, value]) => {
      let cell: unknown
      if (column.startsWith('__json:')) {
        const [obj, key] = column.slice('__json:'.length).split('.')
        cell = ((row[obj] as Row | undefined) ?? {})[key]
        cell = cell == null ? cell : String(cell)
      } else {
        cell = row[column]
      }
      if (op === 'eq') return cell === value
      if (op === 'is') return value === null ? cell === null || cell === undefined : cell === value
      if (op === 'neq') return cell !== value
      if (op === 'not') return cell !== value
      if (op === 'in') return (value as unknown[]).includes(cell)
      if (op === 'lt') return (cell as never) < (value as never)
      if (op === 'lte') return (cell as never) <= (value as never)
      if (op === 'gt') return (cell as never) > (value as never)
      if (op === 'gte') return (cell as never) >= (value as never)
      if (op === 'contains') return Object.entries(value as Record<string, unknown>).every(([k, v]) => (row[column] as Record<string, unknown> | undefined)?.[k] === v)
      return true
    })
  }

  private run(): Result {
    const rows = this.rows()

    if (this.mode === 'insert') {
      const incoming = (Array.isArray(this.payload) ? this.payload : [this.payload]) as Row[]
      // Minimal column defaults for tables whose DDL relies on them.
      const defaults: Row =
        this.table === 'job_queue' ? { status: 'PENDING', attempts: 0, priority: 'NORMAL', progress: 0 } : {}
      const inserted = incoming.map((r) => ({
        id: r.id ?? randomUUID(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...defaults,
        ...r,
      }))
      for (const row of inserted) {
        const violation = this.violatesUniqueIndex(row)
        if (violation) return { data: null, error: { code: '23505', message: violation.message } }
      }
      rows.push(...inserted)
      const data = this.selecting ? (this.singleRow ? inserted[0] : inserted) : null
      return { data, error: null }
    }

    if (this.mode === 'upsert') {
      const incoming = (Array.isArray(this.payload) ? this.payload : [this.payload]) as Row[]
      const out: Row[] = []
      for (const r of incoming) {
        const key = this.onConflict
        const existing = key.length ? rows.find((row) => key.every((k) => row[k] === r[k])) : undefined
        if (existing) Object.assign(existing, r, { updated_at: new Date().toISOString() })
        else rows.push({ id: r.id ?? randomUUID(), created_at: new Date().toISOString(), ...r })
        out.push(existing ?? rows[rows.length - 1])
      }
      return { data: this.selecting ? (this.singleRow ? out[0] : out) : null, error: null }
    }

    if (this.mode === 'update') {
      const targets = rows.filter((row) => this.matches(row))
      for (const row of targets) {
        const next = { ...row, ...this.payload, updated_at: new Date().toISOString() }
        const violation = this.violatesUniqueIndex(next, row)
        if (violation) return { data: null, error: { code: '23505', message: violation.message } }
      }
      for (const row of targets) Object.assign(row, this.payload, { updated_at: new Date().toISOString() })
      const data = this.selecting ? (this.singleRow ? targets[0] : targets) : null
      return { data, error: null }
    }

    if (this.mode === 'delete') {
      const kept = rows.filter((row) => !this.matches(row))
      this.store.set(this.table, kept)
      return { data: null, error: null }
    }

    // select
    let result = rows.filter((row) => this.matches(row))
    if (this.orderBy) {
      const { column, ascending } = this.orderBy
      result = [...result].sort((a, b) => {
        const av = a[column] as never
        const bv = b[column] as never
        return (av < bv ? -1 : av > bv ? 1 : 0) * (ascending ? 1 : -1)
      })
    }
    if (this.limitN != null) result = result.slice(0, this.limitN)
    if (this.singleRow || this.maybe) {
      return { data: result[0] ?? null, error: null }
    }
    return { data: result, error: null }
  }

  then<TResult1 = Result, TResult2 = never>(
    onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    try {
      return Promise.resolve(onfulfilled ? onfulfilled(this.run()) : (this.run() as never))
    } catch (error) {
      return Promise.resolve(onrejected ? onrejected(error) : (Promise.reject(error) as never))
    }
  }
}

export interface FakeStorageObject {
  bytes: Uint8Array
  contentType: string
}

class FakeBucket {
  constructor(
    private readonly objects: Map<string, FakeStorageObject>,
    private readonly failUpload?: (path: string) => boolean,
    private readonly failList?: (path: string) => boolean,
  ) {}

  async upload(path: string, body: ArrayBuffer | Uint8Array | Buffer | string, opts?: { contentType?: string }) {
    if (this.failUpload?.(path)) return { data: null, error: { message: `forced upload failure for ${path}` } }
    const bytes =
      typeof body === 'string'
        ? new TextEncoder().encode(body)
        : body instanceof Uint8Array
          ? new Uint8Array(body)
          : new Uint8Array(body as ArrayBuffer)
    this.objects.set(path, { bytes, contentType: opts?.contentType ?? 'application/octet-stream' })
    return { data: { path }, error: null }
  }

  async download(path: string) {
    const obj = this.objects.get(path)
    if (!obj) return { data: null, error: { message: `not found: ${path}` } }
    return {
      data: { arrayBuffer: async () => obj.bytes.buffer.slice(obj.bytes.byteOffset, obj.bytes.byteOffset + obj.bytes.byteLength) },
      error: null,
    }
  }

  async list(prefix: string, opts?: { limit?: number; offset?: number }) {
    if (this.failList?.(prefix)) return { data: null, error: { message: `forced list failure for ${prefix}` } }
    const base = prefix ? (prefix.endsWith('/') ? prefix : `${prefix}/`) : ''
    const children = new Map<string, { isFile: boolean }>()
    for (const key of this.objects.keys()) {
      if (base && !key.startsWith(base)) continue
      const rest = base ? key.slice(base.length) : key
      const slash = rest.indexOf('/')
      if (slash === -1) children.set(rest, { isFile: true })
      else children.set(rest.slice(0, slash), { isFile: false })
    }
    let entries = [...children.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([name, meta]) =>
        meta.isFile
          ? { name, id: `obj-${name}`, metadata: { size: this.objects.get(`${base}${name}`)?.bytes.byteLength ?? 0 } }
          : { name, id: null, metadata: null },
      )
    const offset = opts?.offset ?? 0
    const limit = opts?.limit ?? 100
    entries = entries.slice(offset, offset + limit)
    return { data: entries, error: null }
  }

  async remove(paths: string[]) {
    for (const p of paths) this.objects.delete(p)
    return { data: null, error: null }
  }
}

export interface FakeSupabase {
  db: Map<string, Row[]>
  objects: Map<string, FakeStorageObject>
  client: {
    from(table: string): FakeQuery
    storage: {
      from(bucket: string): FakeBucket
      listBuckets(): Promise<{ data: Array<{ id: string }> | null; error: { message: string } | null }>
    }
  }
}

export function createFakeSupabase(options?: {
  failUpload?: (path: string) => boolean
  failList?: (path: string) => boolean
  uniqueIndexes?: FakeUniqueIndex[]
}): FakeSupabase {
  const db = new Map<string, Row[]>()
  const objects = new Map<string, FakeStorageObject>()
  const indexes = options?.uniqueIndexes ?? []
  const client = {
    from: (table: string) => new FakeQuery(db, table, indexes),
    storage: {
      from: () => new FakeBucket(objects, options?.failUpload, options?.failList),
      // The fake models one object store; report a single quota bucket so the
      // project-usage probe counts it once.
      listBuckets: async () => ({ data: [{ id: 'quickbooks-migration' }], error: null }),
    },
  }
  return { db, objects, client }
}

/** The "one active step per snapshot" guard from migration 069 (PENDING + RUNNING). */
export const SNAPSHOT_STEP_ACTIVE_INDEX: FakeUniqueIndex = {
  table: 'job_queue',
  where: (row) => row.job_type === 'QUICKBOOKS_SNAPSHOT_STEP' && (row.status === 'PENDING' || row.status === 'RUNNING'),
  key: (row) => `${row.company_id}|${((row.payload as Row | undefined) ?? {}).snapshotId ?? ''}`,
}
