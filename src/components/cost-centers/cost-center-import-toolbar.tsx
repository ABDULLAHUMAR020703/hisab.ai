'use client'

import { useRef, useState } from 'react'
import { Upload, ChevronDown, Download, FileSpreadsheet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { ExportButton } from '@/components/import-export/ExportButton'
import { readApiError } from '@/lib/api-client'

type ImportKind = 'location' | 'class' | 'project'

interface ImportRowError {
  row: number
  value: string
  reason: string
}

interface ImportSummary {
  kind: ImportKind
  imported: number
  skipped: number
  duplicates: number
  failed: number
  errors: ImportRowError[]
}

const IMPORT_OPTIONS: Array<{
  kind: ImportKind
  label: string
  description: string
  formatHint: string
  templateUrl: string
  importUrl: string
}> = [
  {
    kind: 'location',
    label: 'Import Locations',
    description: 'Vertical Location List template (company header + Location full name).',
    formatHint:
      'Ignores company title, “Location List”, and “Location full name”. Each following row becomes a LOCATION.',
    templateUrl: '/api/cost-centers/import/location/template',
    importUrl: '/api/cost-centers/import/location',
  },
  {
    kind: 'class',
    label: 'Import Classes',
    description: 'Vertical Class List template (company header + Class full name).',
    formatHint:
      'Ignores company title, “Class List”, and “Class full name”. Full text is preserved (including Parent:Child).',
    templateUrl: '/api/cost-centers/import/class/template',
    importUrl: '/api/cost-centers/import/class',
  },
  {
    kind: 'project',
    label: 'Import Projects',
    description: 'Horizontal Product/Service List spreadsheet.',
    formatHint:
      'Requires Product/Service Name. All columns are stored for future inventory/sales use. Invoice dropdown uses the name only.',
    templateUrl: '/api/cost-centers/import/project/template',
    importUrl: '/api/cost-centers/import/project',
  },
]

interface Props {
  onImportSuccess?: () => void
}

export function CostCenterImportToolbar({ onImportSuccess }: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [active, setActive] = useState<(typeof IMPORT_OPTIONS)[number] | null>(null)
  const [uploading, setUploading] = useState(false)
  const [summary, setSummary] = useState<ImportSummary | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  function openImport(kind: ImportKind) {
    const option = IMPORT_OPTIONS.find((o) => o.kind === kind) ?? null
    setActive(option)
    setSummary(null)
    setMenuOpen(false)
  }

  async function downloadTemplate() {
    if (!active) return
    const res = await fetch(active.templateUrl)
    if (!res.ok) {
      alert(await readApiError(res))
      return
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download =
      active.kind === 'location'
        ? 'Location-List-template.xlsx'
        : active.kind === 'class'
          ? 'Class-List-template.xlsx'
          : 'Product-Service-List-template.xlsx'
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  async function onFileSelected(files: FileList | null) {
    if (!files?.[0] || !active) return
    setUploading(true)
    setSummary(null)
    try {
      const fd = new FormData()
      fd.append('file', files[0])
      const res = await fetch(active.importUrl, { method: 'POST', body: fd })
      if (!res.ok) {
        alert(await readApiError(res))
        return
      }
      const result = (await res.json()) as ImportSummary
      setSummary(result)
      onImportSuccess?.()
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <div className="relative">
          <Button variant="outline" onClick={() => setMenuOpen((o) => !o)}>
            <Upload size={15} />
            Import
            <ChevronDown size={14} />
          </Button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 z-50 mt-2 w-56 rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
                {IMPORT_OPTIONS.map((option) => (
                  <button
                    key={option.kind}
                    type="button"
                    className="w-full px-4 py-2.5 text-left text-sm hover:bg-slate-50"
                    onClick={() => openImport(option.kind)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <ExportButton moduleKey="cost-centers" />
      </div>

      <Modal
        open={Boolean(active)}
        onClose={() => {
          setActive(null)
          setSummary(null)
        }}
        title={active?.label ?? 'Import'}
        subtitle={active?.description}
        size="md"
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => {
                setActive(null)
                setSummary(null)
              }}
            >
              Close
            </Button>
            <Button onClick={() => fileRef.current?.click()} loading={uploading}>
              <Upload size={14} /> Upload File
            </Button>
          </>
        }
      >
        {active && (
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
              <p className="font-medium text-slate-800">Expected format</p>
              <p className="mt-1">{active.formatHint}</p>
              <p className="mt-2 text-xs text-slate-400">
                Company title rows (e.g. NETKOM COMPANY FOR COMMUNICATION) are ignored automatically.
                Do not change the template headers or orientation.
              </p>
            </div>

            <button
              type="button"
              onClick={downloadTemplate}
              className="inline-flex items-center gap-2 text-sm font-medium text-indigo-600 hover:text-indigo-800"
            >
              <Download size={14} />
              Download {active.kind === 'location' ? 'Location' : active.kind === 'class' ? 'Class' : 'Project'} Template
            </button>

            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => onFileSelected(e.target.files)}
            />

            <div className="flex items-center gap-2 rounded-xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500">
              <FileSpreadsheet size={18} className="text-slate-400" />
              Upload your Excel/CSV file. The importer adapts to the supplied template.
            </div>

            {summary && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm">
                <p className="font-semibold text-emerald-800">Import summary</p>
                <div className="mt-2 grid grid-cols-2 gap-2 text-emerald-900 sm:grid-cols-4">
                  <div><span className="text-emerald-600">Imported</span><p className="font-bold">{summary.imported}</p></div>
                  <div><span className="text-emerald-600">Skipped</span><p className="font-bold">{summary.skipped}</p></div>
                  <div><span className="text-emerald-600">Duplicates</span><p className="font-bold">{summary.duplicates}</p></div>
                  <div><span className="text-emerald-600">Failed</span><p className="font-bold">{summary.failed}</p></div>
                </div>
                {summary.errors.length > 0 && (
                  <ul className="mt-3 max-h-48 space-y-2 overflow-y-auto text-xs text-red-700">
                    {summary.errors.slice(0, 50).map((err) => (
                      <li
                        key={`${err.row}-${err.value}-${err.reason}`}
                        className="rounded-lg border border-red-200 bg-white/80 px-3 py-2"
                      >
                        <p className="font-semibold text-red-800">Row {err.row}</p>
                        {err.value ? (
                          <p className="mt-0.5 text-slate-700">
                            <span className="text-slate-400">Value:</span> {err.value}
                          </p>
                        ) : null}
                        <p className="mt-0.5">
                          <span className="text-slate-400">Reason:</span> {err.reason}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>
    </>
  )
}
