'use client'

interface PreviewStepProps {
  headers: string[]
  rows: Record<string, string>[]
  mappedPreview?: Array<{ rowNumber: number; mapped: Record<string, unknown> }>
}

export function PreviewStep({ headers, rows, mappedPreview }: PreviewStepProps) {
  const previewRows = rows.slice(0, 20)

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-slate-700 mb-2">Original Data (first 20 rows)</h3>
        <div className="overflow-x-auto border border-slate-200 rounded-xl">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100">
                {headers.map((header) => (
                  <th key={header} className="px-3 py-2 text-left font-semibold text-slate-500 whitespace-nowrap">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {previewRows.map((row, index) => (
                <tr key={index} className="border-b border-slate-50">
                  {headers.map((header) => (
                    <td key={header} className="px-3 py-2 text-slate-700 whitespace-nowrap">
                      {row[header] || '—'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {mappedPreview && mappedPreview.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-slate-700 mb-2">Mapped Preview</h3>
          <div className="overflow-x-auto border border-slate-200 rounded-xl">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  <th className="px-3 py-2 text-left font-semibold text-slate-500">Row</th>
                  {Object.keys(mappedPreview[0].mapped).map((key) => (
                    <th key={key} className="px-3 py-2 text-left font-semibold text-slate-500 whitespace-nowrap">
                      {key}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {mappedPreview.map((row) => (
                  <tr key={row.rowNumber} className="border-b border-slate-50">
                    <td className="px-3 py-2 text-slate-500">{row.rowNumber}</td>
                    {Object.keys(mappedPreview[0].mapped).map((key) => (
                      <td key={key} className="px-3 py-2 text-slate-700 whitespace-nowrap">
                        {String(row.mapped[key] ?? '—')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
