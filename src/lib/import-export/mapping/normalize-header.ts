export function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function buildHeaderFingerprint(headers: string[]): string {
  return headers.map(normalizeHeader).sort().join('|')
}
