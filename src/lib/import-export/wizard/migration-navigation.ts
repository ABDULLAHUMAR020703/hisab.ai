/**
 * Navigation decisions for the persistent Migration Center.
 *
 * Migration Center navigation is requested from several places that can all fire
 * while a route transition is still pending (indicator click, wizard redirect,
 * retry, and the wizard page mount effect). These helpers keep that to exactly
 * one `router.push` per target so a pending transition is never restarted.
 */

export type NavigationDecision = 'push' | 'already-there' | 'transition-pending'

/** Where the Integrations / Migrate entry point should send the user. */
export type MigrateEntryAction =
  | { type: 'open-wizard' }
  | { type: 'open-migration-center'; sessionId: string }

export function navigationTarget(location: { pathname: string; hash?: string }): string {
  return `${location.pathname}${location.hash ?? ''}`
}

export function resolveNavigation(input: {
  target: string
  currentTarget: string
  pendingTarget: string | null
}): NavigationDecision {
  // A pending transition to the same target owns the navigation until it settles.
  if (input.pendingTarget === input.target) return 'transition-pending'
  if (input.currentTarget === input.target) return 'already-there'
  return 'push'
}

/**
 * Migrate must open the configuration wizard unless a migration is actively
 * running. Completed / failed / cancelled sessions still have job ids, so
 * `migrationHasStarted` must not be used here — that silently closed the
 * wizard and left the user on Integrations with only a flicker.
 */
export function resolveMigrateEntryAction(
  session: { id: string; config: { state: string } } | null | undefined,
): MigrateEntryAction {
  if (session?.config.state === 'running') {
    return { type: 'open-migration-center', sessionId: session.id }
  }
  return { type: 'open-wizard' }
}
