'use client'

import { useState, useRef } from 'react'
import { Upload, Download, X, CheckCircle, AlertCircle, FileText } from 'lucide-react'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'

export type ImportType = 'expenses' | 'bills' | 'journal'

const CONFIG = {
  expenses: {
    title: 'Import Expenses',
    headers: ['date', 'description', 'category', 'amount', 'taxRate', 'lineDescription'],
    sample: [
      ['2024-01-15', 'Office supplies', 'Office Supplies', '100', '15', 'Pens and paper'],
      ['2024-01-16', 'Team lunch', 'Meals', '250', '0', 'Lunch meeting'],
    ],
    hint: 'Each row = one expense. category must be one of: Travel, Meals, Office Supplies, Utilities, Software, Equipment, Marketing, Other',
    endpoint: '/api/expenses/import',
  },
  bills: {
    title: 'Import Bills',
    headers: ['vendorName', 'date', 'dueDate', 'reference', 'lineDescription', 'quantity', 'unitPrice', 'taxRate'],
    sample: [
      ['Acme Corp', '2024-01-15', '2024-02-15', 'INV-001', 'Web hosting', '1', '99.99', '0'],
      ['Acme Corp', '2024-01-15', '2024-02-15', 'INV-001', 'Domain renewal', '1', '12.99', '0'],
      ['Beta Ltd', '2024-01-20', '2024-02-20', 'INV-002', 'Consulting', '2', '500', '15'],
    ],
    hint: 'Rows with the same vendorName+date+dueDate+reference are grouped into one bill. Vendor must already exist.',
    endpoint: '/api/bills/import',
  },
  journal: {
    title: 'Import Journal Entries',
    headers: ['date', 'description', 'reference', 'accountNo', 'debit', 'credit'],
    sample: [
      ['2024-01-15', 'Bank deposit', 'JV-001', '1010', '5000', '0'],
      ['2024-01-15', 'Bank deposit', 'JV-001', '4010', '0', '5000'],
      ['2024-01-16', 'Rent payment', 'JV-002', '6010', '2000', '0'],
      ['2024-01-16', 'Rent payment', 'JV-002', '1010', '0', '2000'],
    ],
    hint: 'Rows with the same date+description+reference are grouped into one entry. Debits must equal credits per entry.',
    endpoint: '/api/journal/import',
  },
} as const

function parseCSV(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.trim().split('\n').map(l => l.replace(/\r$/, ''))
  if (lines.length < 2) return { headers: [], rows: [] }

  const parseRow = (line: string): string[] => {
    const result: string[] = []
    let cur = ''
    let inQuotes = false
    for (const ch of line) {
      if (ch === '"') { inQuotes = !inQuotes }
      else if (ch === ',' && !inQuotes) { result.push(cur.trim()); cur = '' }
      else { cur += ch }
    }
    result.push(cur.trim())
    return result
  }

  const headers = parseRow(lines[0])
  const rows = lines.slice(1).filter(l => l.trim()).map(line => {
    const values = parseRow(line)
    return Object.fromEntries(headers.map((h, i) => [h, values[i] ?? '']))
  })

  return { headers, rows }
}

function downloadCSV(filename: string, headers: readonly string[], sample: readonly (readonly string[])[]) {
  const content = [headers.join(','), ...sample.map(r => r.join(','))].join('\n')
  const blob = new Blob([content], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

interface Props {
  type: ImportType
  open: boolean
  onClose: () => void
  onSuccess: () => void
}

export function CsvImportModal({ type, open, onClose, onSuccess }: Props) {
  const cfg = CONFIG[type]
  const [rows, setRows] = useState<Record<string, string>[]>([])
  const [headers, setHeaders] = useState<string[]>([])
  const [fileName, setFileName] = useState('')
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<{ created: number; errors: string[] } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  function reset() {
    setRows([]); setHeaders([]); setFileName(''); setResult(null)
  }

  function handleFile(file: File) {
    setResult(null)
    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = e => {
      const parsed = parseCSV(e.target?.result as string)
      setHeaders(parsed.headers)
      setRows(parsed.rows)
    }
    reader.readAsText(file)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  async function handleImport() {
    setImporting(true)
    try {
      const res = await fetch(cfg.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows }),
      })
      const data = await res.json()
      setResult(data)
      if (data.created > 0) onSuccess()
    } finally {
      setImporting(false)
    }
  }

  function handleClose() { reset(); onClose() }

  const hasPreview = rows.length > 0 && !result

  return (
    <Modal open={open} onClose={handleClose} title={cfg.title} size="xl"
      footer={
        hasPreview ? (
          <>
            <Button variant="outline" onClick={handleClose}>Cancel</Button>
            <Button onClick={handleImport} loading={importing}>
              <Upload size={14} /> Import {rows.length} rows
            </Button>
          </>
        ) : (
          <Button variant="outline" onClick={handleClose}>{result ? 'Close' : 'Cancel'}</Button>
        )
      }
    >
      <div className="space-y-4">
        {/* Template row */}
        <div className="flex items-start justify-between gap-4 p-3.5 bg-slate-50 rounded-xl border border-slate-200">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-slate-700 uppercase tracking-wide mb-0.5">Required columns</p>
            <p className="text-xs text-slate-500 font-mono">{cfg.headers.join(', ')}</p>
            <p className="text-xs text-slate-400 mt-1">{cfg.hint}</p>
          </div>
          <Button variant="outline" onClick={() => downloadCSV(`${type}-template.csv`, cfg.headers, cfg.sample)} className="shrink-0">
            <Download size={13} /> Template
          </Button>
        </div>

        {/* Drop zone */}
        {!hasPreview && !result && (
          <div
            onDrop={handleDrop}
            onDragOver={e => e.preventDefault()}
            onClick={() => fileRef.current?.click()}
            className="border-2 border-dashed border-slate-300 rounded-xl p-12 text-center cursor-pointer hover:border-indigo-400 hover:bg-indigo-50/30 transition-colors"
          >
            <Upload size={30} className="mx-auto mb-3 text-slate-300" />
            <p className="text-sm font-semibold text-slate-600">Drop your CSV here or click to browse</p>
            <p className="text-xs text-slate-400 mt-1">CSV files only (.csv)</p>
            <input
              ref={fileRef} type="file" accept=".csv" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }}
            />
          </div>
        )}

        {/* Preview table */}
        {hasPreview && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-sm">
                <FileText size={14} className="text-slate-400" />
                <span className="font-semibold text-slate-700">{fileName}</span>
                <span className="text-slate-400">{rows.length} rows detected</span>
              </div>
              <button onClick={reset} className="p-1 text-slate-400 hover:text-slate-600 rounded transition-colors">
                <X size={14} />
              </button>
            </div>
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <div className="overflow-x-auto max-h-56 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 sticky top-0 z-10">
                    <tr className="border-b border-slate-200">
                      {headers.map((h, i) => (
                        <th key={i} className="px-3 py-2 text-left font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {rows.slice(0, 25).map((row, i) => (
                      <tr key={i} className="hover:bg-slate-50">
                        {headers.map((h, j) => (
                          <td key={j} className="px-3 py-1.5 text-slate-600 whitespace-nowrap">{row[h]}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rows.length > 25 && (
                <div className="px-3 py-2 text-xs text-slate-400 bg-slate-50 border-t border-slate-100">
                  +{rows.length - 25} more rows not shown
                </div>
              )}
            </div>
          </div>
        )}

        {/* Result */}
        {result && (
          <div className="space-y-3">
            <div className={`flex items-center gap-3 p-4 rounded-xl border ${result.created > 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
              <CheckCircle size={20} className="text-emerald-500 shrink-0" />
              <div>
                <p className="font-semibold text-emerald-700 text-sm">
                  {result.created} {type === 'journal' ? 'journal entries' : type} imported successfully
                </p>
                {result.errors.length > 0 && (
                  <p className="text-xs text-amber-600 mt-0.5">{result.errors.length} row{result.errors.length > 1 ? 's' : ''} skipped due to errors</p>
                )}
              </div>
            </div>
            {result.errors.length > 0 && (
              <div className="border border-rose-200 rounded-xl bg-rose-50 max-h-44 overflow-y-auto">
                <div className="px-3 py-2 border-b border-rose-100 flex items-center gap-1.5">
                  <AlertCircle size={12} className="text-rose-500" />
                  <span className="text-xs font-semibold text-rose-700">Errors ({result.errors.length})</span>
                </div>
                <div className="px-3 py-2 space-y-1">
                  {result.errors.map((e, i) => (
                    <p key={i} className="text-xs text-rose-600">{e}</p>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
