import type { DuplicateMatch, DuplicateStrategy, ImportContext, MappedRow, ModuleDefinition } from '../types'

export async function detectDuplicates(
  module: ModuleDefinition,
  rows: MappedRow[],
  ctx: ImportContext,
): Promise<DuplicateMatch[]> {
  if (module.findDuplicatesBatch) {
    return module.findDuplicatesBatch(rows, ctx)
  }

  const matches: DuplicateMatch[] = []
  const parser = module.parseImportRow ?? ((mapped: Record<string, unknown>) => mapped)

  for (const row of rows) {
    const record = parser(row.mapped as Record<string, unknown>)
    const duplicate = await module.findDuplicate(record, ctx)
    if (duplicate) {
      matches.push({
        rowNumber: row.rowNumber,
        existingId: duplicate.id,
        matchedOn: duplicate.matchedOn,
      })
    }
  }

  return matches
}

export function duplicateMatchesToMap(matches: DuplicateMatch[]): Map<number, DuplicateMatch> {
  return new Map(matches.map((match) => [match.rowNumber, match]))
}

export function applyDuplicateStrategy(
  strategy: DuplicateStrategy,
  hasDuplicate: boolean,
): 'import' | 'update' | 'skip' | 'create' {
  if (!hasDuplicate) return 'import'
  if (strategy === 'skip') return 'skip'
  if (strategy === 'update') return 'update'
  return 'create'
}
