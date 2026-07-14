import 'server-only'
import { resolveCompanyId, supabaseDb } from '@/lib/db/repository-utils'
import { getModuleDisplayName } from '../registry/module-catalog'
import type { ImportHistoryRecord, ImportHistoryListResult } from './import-history.types'
import type { ImportJobStatus } from '../types'
import { TERMINAL_JOB_STATUSES } from '../types'

function mapHistoryRow(
  row: Record<string, unknown>,
  profile?: { id: string; full_name: string | null } | null,
): ImportHistoryRecord {
  return {
    id: String(row.id),
    moduleKey: String(row.module_key),
    moduleDisplayName: getModuleDisplayName(String(row.module_key)),
    filename: String(row.filename),
    fileFormat: row.file_format as 'csv' | 'xlsx',
    duplicateStrategy: (row.duplicate_strategy as ImportHistoryRecord['duplicateStrategy']) ?? null,
    status: row.status as ImportJobStatus,
    totalRows: Number(row.total_rows ?? 0),
    importedCount: Number(row.imported_count ?? 0),
    updatedCount: Number(row.updated_count ?? 0),
    skippedCount: Number(row.skipped_count ?? 0),
    failedCount: Number(row.failed_count ?? 0),
    durationMs: row.duration_ms === null || row.duration_ms === undefined ? null : Number(row.duration_ms),
    createdAt: String(row.created_at),
    completedAt: row.completed_at ? String(row.completed_at) : null,
    user: {
      id: String(row.user_id),
      name: profile?.full_name ?? null,
    },
    hasErrorReport: Number(row.failed_count ?? 0) > 0,
  }
}

export async function listImportHistory(query: {
  page?: number
  limit?: number
  search?: string
  module?: string
  status?: string[]
  dateFrom?: string
  dateTo?: string
  sortBy?: string
  sortDir?: 'asc' | 'desc'
  includeActive?: boolean
}): Promise<ImportHistoryListResult> {
  const db = supabaseDb()
  const companyId = await resolveCompanyId()
  const page = Math.max(1, query.page ?? 1)
  const limit = Math.min(100, Math.max(1, query.limit ?? 25))
  const from = (page - 1) * limit
  const to = from + limit - 1

  let builder = db
    .from('import_jobs')
    .select('*', { count: 'exact' })
    .eq('company_id', companyId)

  if (!query.includeActive) {
    builder = builder.in('status', TERMINAL_JOB_STATUSES)
  }

  if (query.search?.trim()) {
    builder = builder.ilike('filename', `%${query.search.trim()}%`)
  }
  if (query.module) {
    builder = builder.eq('module_key', query.module)
  }
  if (query.status?.length) {
    builder = builder.in('status', query.status)
  }
  if (query.dateFrom) {
    builder = builder.gte('created_at', query.dateFrom)
  }
  if (query.dateTo) {
    builder = builder.lte('created_at', query.dateTo)
  }

  const sortBy = query.sortBy ?? 'created_at'
  const allowedSort = new Set([
    'created_at',
    'completed_at',
    'filename',
    'module_key',
    'status',
    'total_rows',
    'imported_count',
    'duration_ms',
  ])
  const sortColumn = allowedSort.has(sortBy) ? sortBy : 'created_at'
  builder = builder.order(sortColumn, { ascending: query.sortDir === 'asc' })

  const { data, error, count } = await builder.range(from, to)
  if (error) throw error

  const userIds = [...new Set((data ?? []).map((row) => String(row.user_id)))]
  const profiles = new Map<string, { id: string; full_name: string | null }>()

  if (userIds.length > 0) {
    const { data: profileRows, error: profileError } = await db
      .from('profiles')
      .select('id, full_name')
      .in('id', userIds)

    if (profileError) throw profileError
    for (const profile of profileRows ?? []) {
      profiles.set(String(profile.id), {
        id: String(profile.id),
        full_name: profile.full_name ? String(profile.full_name) : null,
      })
    }
  }

  return {
    items: (data ?? []).map((row) =>
      mapHistoryRow(row, profiles.get(String(row.user_id)) ?? null),
    ),
    total: count ?? 0,
    page,
    limit,
  }
}

export async function getImportHistoryDetail(id: string) {
  const db = supabaseDb()
  const companyId = await resolveCompanyId()

  const { data, error } = await db
    .from('import_jobs')
    .select('*')
    .eq('id', id)
    .eq('company_id', companyId)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  const { data: profile } = await db
    .from('profiles')
    .select('id, full_name')
    .eq('id', data.user_id)
    .maybeSingle()

  const { count: errorCount } = await db
    .from('import_job_errors')
    .select('*', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .eq('job_id', id)

  return {
    id: String(data.id),
    moduleKey: String(data.module_key),
    moduleDisplayName: getModuleDisplayName(String(data.module_key)),
    filename: String(data.filename),
    fileFormat: data.file_format as 'csv' | 'xlsx',
    duplicateStrategy: (data.duplicate_strategy as ImportHistoryRecord['duplicateStrategy']) ?? null,
    status: data.status as ImportJobStatus,
    totalRows: Number(data.total_rows ?? 0),
    importedCount: Number(data.imported_count ?? 0),
    updatedCount: Number(data.updated_count ?? 0),
    skippedCount: Number(data.skipped_count ?? 0),
    failedCount: Number(data.failed_count ?? 0),
    validRows: data.valid_rows === null ? null : Number(data.valid_rows),
    invalidRows: data.invalid_rows === null ? null : Number(data.invalid_rows),
    warningCount: data.warning_count === null ? null : Number(data.warning_count),
    durationMs: data.duration_ms === null ? null : Number(data.duration_ms),
    createdAt: String(data.created_at),
    completedAt: data.completed_at ? String(data.completed_at) : null,
    user: {
      id: String(data.user_id),
      name: profile?.full_name ? String(profile.full_name) : null,
    },
    mappingSnapshot: (data.mapping_snapshot as Record<string, string> | null) ?? null,
    validationSummary: (data.validation_summary as Record<string, number> | null) ?? null,
    hasErrorReport: (errorCount ?? 0) > 0 || Number(data.failed_count ?? 0) > 0,
  }
}

export async function deleteImportHistory(id: string): Promise<boolean> {
  const db = supabaseDb()
  const companyId = await resolveCompanyId()
  const { data, error } = await db
    .from('import_jobs')
    .delete()
    .eq('id', id)
    .eq('company_id', companyId)
    .select('id')

  if (error) throw error
  return (data?.length ?? 0) > 0
}
