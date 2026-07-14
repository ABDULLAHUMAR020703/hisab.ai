'use client'

import type { DuplicateStrategy } from '@/lib/import-export/types'
import { DUPLICATE_STRATEGY_LABELS } from '@/lib/import-export/duplicate/strategies'

interface DuplicateStepProps {
  duplicateCount: number
  strategy: DuplicateStrategy
  onStrategyChange: (strategy: DuplicateStrategy) => void
}

const STRATEGIES: DuplicateStrategy[] = ['skip', 'update', 'create']

export function DuplicateStep({ duplicateCount, strategy, onStrategyChange }: DuplicateStepProps) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        {duplicateCount > 0
          ? `${duplicateCount} row(s) match existing records in your company.`
          : 'No duplicate records detected.'}
      </p>

      <div className="space-y-3">
        {STRATEGIES.map((item) => (
          <label
            key={item}
            className={`flex items-start gap-3 rounded-xl border p-4 cursor-pointer transition-colors ${
              strategy === item ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200 hover:border-slate-300'
            }`}
          >
            <input
              type="radio"
              name="duplicateStrategy"
              checked={strategy === item}
              onChange={() => onStrategyChange(item)}
              className="mt-1"
            />
            <div>
              <p className="text-sm font-semibold text-slate-800">{DUPLICATE_STRATEGY_LABELS[item]}</p>
              <p className="text-xs text-slate-500 mt-0.5">
                {item === 'skip' && 'Keep existing records and skip matching import rows.'}
                {item === 'update' && 'Update existing records with imported data.'}
                {item === 'create' && 'Create new records even when duplicates exist.'}
              </p>
            </div>
          </label>
        ))}
      </div>
    </div>
  )
}
