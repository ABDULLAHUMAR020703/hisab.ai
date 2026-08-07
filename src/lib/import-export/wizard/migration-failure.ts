import { normalizeImportError } from '../import/import-error'
import type {
  ImportRowError,
  MigrationActivityEvent,
  MigrationProgressSnapshot,
  ModuleFailureSnapshot,
} from '../types'

export type { ModuleFailureSnapshot }

type FailureCarrier = {
  failure: {
    message: string
    stage: string | null
    errorCode: string | null
    correlationId: string | null
    retryable: boolean
  } | null
  phase: string
}

type JobFailureSource = {
  status: string
  currentStage?: string | null
  activityEvents?: MigrationActivityEvent[]
  progressSnapshot?: MigrationProgressSnapshot
}

export function isModuleFailureSnapshot(value: unknown): value is ModuleFailureSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return typeof record.message === 'string' && record.message.trim().length > 0
}

export function readPersistedModuleFailure(
  snapshot: MigrationProgressSnapshot | null | undefined,
): ModuleFailureSnapshot | null {
  return isModuleFailureSnapshot(snapshot?.failure) ? snapshot.failure : null
}

/** Builds a durable failure record from a thrown exception (never a bare "Failed"). */
export function buildModuleFailureFromException(
  error: unknown,
  options: {
    stage?: string | null
    correlationId?: string | null
    includeStack?: boolean
  } = {},
): ModuleFailureSnapshot {
  const normalized = normalizeImportError(error)
  const stage = options.stage
    ?? (typeof normalized.details.stage === 'string' ? normalized.details.stage : null)
    ?? null
  const retryable = normalized.errorCode === 'MISSING_DEPENDENCY'
    || normalized.details.status === 'missing_dependency'
    || /timeout|temporar|deadlock|connection/i.test(normalized.message)
  const stack = options.includeStack && error instanceof Error && error.stack
    ? error.stack
    : null
  return {
    message: normalized.message.trim() || 'Import failed with an unknown error.',
    stage,
    errorCode: normalized.errorCode === 'IMPORT_FAILED' ? 'IMPORT_FATAL' : normalized.errorCode,
    errorType: error instanceof Error ? error.name : 'Error',
    correlationId: options.correlationId ?? null,
    retryable,
    rowNumber: null,
    stack,
  }
}

/** Summarizes row-level import errors into one module failure when the job ends failed. */
export function buildModuleFailureFromRowErrors(
  errors: ImportRowError[],
  options: { stage?: string | null } = {},
): ModuleFailureSnapshot | null {
  if (errors.length === 0) return null
  const primary = errors[0]!
  const stage = options.stage
    ?? (typeof primary.details?.stage === 'string' ? primary.details.stage : null)
    ?? 'validation'
  const uniqueMessages = [...new Set(errors.map((item) => item.message.trim()).filter(Boolean))]
  const message = errors.length === 1
    ? primary.message
    : uniqueMessages.length === 1
      ? `${errors.length} records failed: ${uniqueMessages[0]}`
      : `${errors.length} records failed. First error: ${primary.message}`
  return {
    message,
    stage,
    errorCode: primary.errorCode,
    errorType: 'ImportRowError',
    correlationId: null,
    retryable: primary.errorCode === 'MISSING_DEPENDENCY',
    rowNumber: primary.rowNumber > 0 ? primary.rowNumber : null,
    stack: null,
  }
}

function failureFromActivity(events: MigrationActivityEvent[] | undefined): ModuleFailureSnapshot | null {
  if (!events?.length) return null
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!
    if (event.type !== 'stage_failed') continue
    const message = event.message?.trim()
    if (!message) continue
    // Skip the old generic "Failed materialization" style labels when a richer
    // exception message exists on another stage_failed event.
    if (/^failed[\s_]+[a-z0-9_ ]+$/i.test(message)) continue
    return {
      message,
      stage: event.stage ?? null,
      errorCode: 'IMPORT_FATAL',
      errorType: 'StageFailed',
      correlationId: null,
      retryable: false,
      rowNumber: null,
      stack: null,
    }
  }
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!
    if (event.type !== 'stage_failed') continue
    return {
      message: event.message?.trim() || `Failed during ${event.stage ?? 'import'}`,
      stage: event.stage ?? null,
      errorCode: 'IMPORT_FATAL',
      errorType: 'StageFailed',
      correlationId: null,
      retryable: false,
      rowNumber: null,
      stack: null,
    }
  }
  return null
}

/**
 * Derives the lifecycle `failure` object from persisted job facts so Migration
 * Center never falls back to the phase label "Failed" when evidence exists.
 */
export function deriveModuleFailure(
  entry: FailureCarrier,
  snapshot: JobFailureSource,
): FailureCarrier['failure'] {
  const persisted = readPersistedModuleFailure(snapshot.progressSnapshot)
  if (persisted) {
    return {
      message: persisted.message,
      stage: persisted.stage,
      errorCode: persisted.errorCode,
      correlationId: persisted.correlationId,
      retryable: persisted.retryable,
    }
  }

  if (entry.failure?.message && entry.failure.message !== 'Failed') {
    return entry.failure
  }

  const fromActivity = failureFromActivity(snapshot.activityEvents)
  if (fromActivity) {
    return {
      message: fromActivity.message,
      stage: fromActivity.stage,
      errorCode: fromActivity.errorCode,
      correlationId: fromActivity.correlationId,
      retryable: fromActivity.retryable,
    }
  }

  if (entry.failure) return entry.failure
  if (entry.phase === 'failed' || String(snapshot.status).toLowerCase() === 'failed') {
    const stage = snapshot.currentStage ?? snapshot.progressSnapshot?.currentStage ?? null
    return {
      message: stage
        ? `Module failed during ${stage.replaceAll('_', ' ')}.`
        : 'Module failed without a persisted error message.',
      stage,
      errorCode: 'IMPORT_FATAL',
      correlationId: null,
      retryable: false,
    }
  }
  return null
}

export function withProgressSnapshotFailure(
  snapshot: MigrationProgressSnapshot | null | undefined,
  failure: ModuleFailureSnapshot | null | undefined,
): MigrationProgressSnapshot {
  const base = { ...(snapshot ?? {}) }
  if (!failure) return base
  return { ...base, failure, currentStage: failure.stage ?? base.currentStage ?? null }
}
