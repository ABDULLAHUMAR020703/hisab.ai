'use client'

import type { ValidationResult } from '@/lib/import-export/types'

interface ValidationSummaryProps {
  validation: ValidationResult
}

export function ValidationSummary({ validation }: ValidationSummaryProps) {
  const errorRows = new Set(
    validation.issues.filter((issue) => issue.severity === 'error').map((issue) => issue.rowNumber),
  )
  const warningRows = new Set(
    validation.issues.filter((issue) => issue.severity === 'warning').map((issue) => issue.rowNumber),
  )

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-xl border border-red-200 bg-red-50 p-4">
          <p className="text-xs uppercase tracking-wide text-red-500 font-semibold">Errors</p>
          <p className="text-2xl font-bold text-red-700 mt-1">{errorRows.size}</p>
          <p className="text-xs text-red-600 mt-1">Rows with blocking errors will be skipped</p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-xs uppercase tracking-wide text-amber-600 font-semibold">Warnings</p>
          <p className="text-2xl font-bold text-amber-700 mt-1">{warningRows.size}</p>
          <p className="text-xs text-amber-700 mt-1">Warnings will not block valid rows</p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-100">
              <th className="px-4 py-2 text-left text-slate-500">Row</th>
              <th className="px-4 py-2 text-left text-slate-500">Field</th>
              <th className="px-4 py-2 text-left text-slate-500">Severity</th>
              <th className="px-4 py-2 text-left text-slate-500">Message</th>
            </tr>
          </thead>
          <tbody>
            {validation.issues.slice(0, 50).map((issue, index) => (
              <tr key={`${issue.rowNumber}-${index}`} className="border-b border-slate-50">
                <td className="px-4 py-2">{issue.rowNumber}</td>
                <td className="px-4 py-2">{issue.fieldKey ?? '—'}</td>
                <td className="px-4 py-2 capitalize">{issue.severity}</td>
                <td className="px-4 py-2">{issue.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {validation.issues.length > 50 && (
          <p className="px-4 py-2 text-xs text-slate-400">
            Showing first 50 of {validation.issues.length} issues
          </p>
        )}
      </div>
    </div>
  )
}
