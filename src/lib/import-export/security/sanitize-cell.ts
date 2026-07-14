/** Prefix values that could be interpreted as formulas in Excel/CSV consumers. */
const FORMULA_PREFIX = /^[=+\-@\t\r]/

export function sanitizeExportCell(value: string | number | boolean | null | undefined): string {
  const text = String(value ?? '')
  if (FORMULA_PREFIX.test(text)) {
    return `'${text}`
  }
  return text
}
