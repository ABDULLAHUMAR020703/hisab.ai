/**
 * Resolve the continuation flag for one durable source page. Provider-backed
 * pagers report through callbacks; non-paginated resources report it on the
 * returned resource instead.
 */
export function resolveSourcePageHasMore(observedHasMore: boolean, resourceHasMore?: boolean): boolean {
  return typeof resourceHasMore === 'boolean' ? resourceHasMore : observedHasMore
}
