import 'server-only'
import { supabaseDb } from '@/lib/db/repository-utils'
import { logger } from '@/lib/ops/logger'

export const REQUIRED_IMPORT_JOB_SCHEMA_VERSION = '067_quickbooks_durable_scheduler_guards'

let compatibilityCheck: Promise<void> | null = null

/**
 * Fails closed when the deployed process is pointed at a database older than
 * the migration worker. Selecting the columns is intentional: PostgREST
 * validates their existence even when the table is empty.
 */
export function assertImportJobSchemaCompatibility(): Promise<void> {
  compatibilityCheck ??= (async () => {
    const { error } = await supabaseDb()
      .from('import_jobs')
      .select('id,progress_snapshot,activity_events,migration_session_id,migration_resource_key')
      .limit(1)

    if (error) {
      logger.error('platform.schema.incompatible', {
        requiredVersion: REQUIRED_IMPORT_JOB_SCHEMA_VERSION,
        table: 'import_jobs',
        requiredColumns: ['progress_snapshot', 'activity_events', 'migration_session_id', 'migration_resource_key'],
        error: { code: error.code, message: error.message, details: error.details, hint: error.hint },
      })
      throw new Error(`Database schema ${REQUIRED_IMPORT_JOB_SCHEMA_VERSION} is required. Apply supabase/migrations/067_quickbooks_durable_scheduler_guards.sql before starting this process. ${error.message}`)
    }

    logger.info('platform.schema.compatible', {
      requiredVersion: REQUIRED_IMPORT_JOB_SCHEMA_VERSION,
      table: 'import_jobs',
        requiredColumns: ['progress_snapshot', 'activity_events', 'migration_session_id', 'migration_resource_key'],
    })
  })().catch((error) => {
    compatibilityCheck = null
    throw error
  })

  return compatibilityCheck
}
