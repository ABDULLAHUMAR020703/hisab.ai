import { nextCoordinationAction } from './migration-coordination'
import type { ModuleLifecycleEntry } from './module-lifecycle'
import type { HydratedMigrationSession } from './migration-session'

export type MigrationStartBootstrapPlan =
  | { type: 'none' }
  | { type: 'create-and-enqueue'; module: ModuleLifecycleEntry }
  | { type: 'enqueue-only'; module: ModuleLifecycleEntry }

/**
 * Plans the server-side work that must happen when a migration starts so the
 * worker has a queue row without waiting on the browser coordinator.
 *
 * Mirrors `nextCoordinationAction` for the first unfinished module: create the
 * import job when missing, then enqueue. Later modules still advance via the
 * provider (or a future server-side completion hook).
 */
export function planMigrationStartBootstrap(
  session: HydratedMigrationSession,
): MigrationStartBootstrapPlan {
  if (session.config.state !== 'running') return { type: 'none' }

  const action = nextCoordinationAction(session, new Set())
  if (action.type === 'create-job') {
    return { type: 'create-and-enqueue', module: action.module }
  }
  if (action.type === 'run-job') {
    return { type: 'enqueue-only', module: action.module }
  }
  return { type: 'none' }
}
