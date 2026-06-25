/** Strip cache-busting query params before persisting logo URLs. */
export function stripLogoCacheBuster(url: string | null | undefined): string | null {
  if (!url?.trim()) return null
  return url.split('?')[0]
}

export function logoCacheVersion(uploadedAt: string | Date | null | undefined): number | null {
  if (!uploadedAt) return null
  const time = typeof uploadedAt === 'string' ? Date.parse(uploadedAt) : uploadedAt.getTime()
  return Number.isFinite(time) ? time : null
}

/** Append a version query so browsers fetch the latest logo after replace. */
export function withLogoCacheBuster(
  url: string | null | undefined,
  uploadedAt: string | Date | null | undefined,
): string | null {
  const base = stripLogoCacheBuster(url)
  if (!base) return null
  const version = logoCacheVersion(uploadedAt) ?? Date.now()
  return `${base}?v=${version}`
}
