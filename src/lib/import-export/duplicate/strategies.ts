export type { DuplicateStrategy } from '../types'

export const DUPLICATE_STRATEGY_LABELS: Record<string, string> = {
  skip: 'Skip Existing',
  update: 'Update Existing',
  create: 'Create Duplicate',
}
