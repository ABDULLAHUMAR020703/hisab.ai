'use client'

import type { FieldDefinition } from '@/lib/import-export/types'
import { validateMappingConflicts } from '@/lib/import-export/mapping/auto-mapper'

interface MappingStepProps {
  headers: string[]
  fields: FieldDefinition[]
  mapping: Record<string, string | null>
  onChange: (mapping: Record<string, string | null>) => void
}

export function MappingStep({ headers, fields, mapping, onChange }: MappingStepProps) {
  const importableFields = fields.filter((field) => field.importable !== false)

  function updateMapping(header: string, value: string) {
    onChange({
      ...mapping,
      [header]: value || null,
    })
  }

  const mappedFieldKeys = new Set(
    Object.values(mapping).filter((value): value is string => Boolean(value)),
  )

  const unmappedRequired = importableFields.filter(
    (field) => field.required && !mappedFieldKeys.has(field.key),
  )

  const conflictMessage = validateMappingConflicts(mapping)

  return (
    <div className="space-y-4">
      {conflictMessage && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {conflictMessage}
        </div>
      )}
      {unmappedRequired.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Map all required fields before continuing: {unmappedRequired.map((field) => field.label).join(', ')}
        </div>
      )}

      <div className="overflow-x-auto border border-slate-200 rounded-xl">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50">
              <th className="px-4 py-3 text-left font-semibold text-slate-500">File Column</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-500">Maps To</th>
            </tr>
          </thead>
          <tbody>
            {headers.map((header) => (
              <tr key={header} className="border-b border-slate-50">
                <td className="px-4 py-3 font-medium text-slate-700">{header}</td>
                <td className="px-4 py-3">
                  <select
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    value={mapping[header] ?? ''}
                    onChange={(event) => updateMapping(header, event.target.value)}
                  >
                    <option value="">— Skip —</option>
                    {importableFields.map((field) => (
                      <option key={field.key} value={field.key}>
                        {field.label}{field.required ? ' *' : ''}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function isMappingComplete(
  fields: FieldDefinition[],
  mapping: Record<string, string | null>,
): boolean {
  if (validateMappingConflicts(mapping)) return false
  const mapped = new Set(Object.values(mapping).filter(Boolean))
  return fields
    .filter((field) => field.importable !== false && field.required)
    .every((field) => mapped.has(field.key))
}
