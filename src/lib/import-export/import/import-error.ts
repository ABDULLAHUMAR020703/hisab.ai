export interface ImportErrorDetails {
  stage?: string
  code?: string
  detail?: string
  hint?: string
  constraint?: string
  table?: string
  column?: string
  status?: string
  rootCause?: string
  dependency?: string
}

export class MissingDependencyError extends Error {
  readonly code = 'MISSING_DEPENDENCY'
  readonly status = 'missing_dependency'

  constructor(readonly dependency: string, message: string) {
    super(message)
    this.name = 'MissingDependencyError'
  }
}

function text(record: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

export function normalizeImportError(error: unknown): { errorCode: string; message: string; details: ImportErrorDetails } {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : {}
  const message = error instanceof Error ? error.message : text(record, 'message') ?? String(error ?? 'Import failed')
  const code = text(record, 'code') ?? (error instanceof MissingDependencyError ? error.code : 'IMPORT_FAILED')
  const constraint = text(record, 'constraint') ?? /constraint ["']([^"']+)["']/i.exec(message)?.[1]
  const table = text(record, 'table') ?? /relation ["']([^"']+)["']/i.exec(message)?.[1]
  const column = text(record, 'column') ?? /column ["']([^"']+)["']/i.exec(message)?.[1]
  const dependency = error instanceof MissingDependencyError ? error.dependency : text(record, 'dependency')
  const status = error instanceof MissingDependencyError ? error.status : text(record, 'status')
  return {
    errorCode: code,
    message,
    details: {
      code,
      detail: text(record, 'details', 'detail'),
      hint: text(record, 'hint'),
      constraint,
      table,
      column,
      status,
      rootCause: dependency ? 'A required upstream QuickBooks record has not completed migration.' : undefined,
      dependency,
    },
  }
}
