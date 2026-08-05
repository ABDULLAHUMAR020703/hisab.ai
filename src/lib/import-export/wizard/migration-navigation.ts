/**
 * Navigation decisions for the persistent Migration Center.
 *
 * Migration Center navigation is requested from several places that can all fire
 * while a route transition is still pending (indicator click, wizard redirect,
 * retry, and the wizard page mount effect). These helpers keep that to exactly
 * one `router.push` per target so a pending transition is never restarted.
 */

export type NavigationDecision = 'push' | 'already-there' | 'transition-pending'

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
