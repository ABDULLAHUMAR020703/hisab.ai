'use client'

import { useRef, useState } from 'react'
import { Upload, Download, FileSpreadsheet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { readApiError } from '@/lib/api-client'

interface UploadStepProps {
  moduleKey: string
  onParsed: (payload: {
    filename: string
    format: 'csv' | 'xlsx'
    headers: string[]
    rows: Record<string, string>[]
    suggestedMapping: Record<string, string | null>
    headerFingerprint: string
    templateId: string | null
    officialTemplateId: string | null
    officialTemplateName: string | null
    skipMapping: boolean
  }) => void
}

export function UploadStep({ moduleKey, onParsed }: UploadStepProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function processFile(file: File) {
    setLoading(true)
    setError(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const response = await fetch(`/api/import-export/${moduleKey}/parse`, {
        method: 'POST',
        body: formData,
      })
      if (!response.ok) {
        throw new Error(await readApiError(response))
      }
      const payload = await response.json()
      onParsed({
        filename: payload.filename,
        format: payload.format,
        headers: payload.headers,
        rows: payload.rows,
        suggestedMapping: payload.suggestedMapping,
        headerFingerprint: payload.headerFingerprint,
        templateId: payload.templateId,
        officialTemplateId: payload.officialTemplateId ?? null,
        officialTemplateName: payload.officialTemplateName ?? null,
        skipMapping: Boolean(payload.skipMapping),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse file')
    } finally {
      setLoading(false)
    }
  }

  async function downloadTemplate(format: 'csv' | 'xlsx') {
    const response = await fetch(`/api/import-export/${moduleKey}/template?format=${format}`)
    if (!response.ok) {
      alert(await readApiError(response))
      return
    }
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${moduleKey}-template.${format}`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4">
      <div
        className={`border-2 border-dashed rounded-2xl p-10 text-center transition-colors ${
          dragging ? 'border-indigo-400 bg-indigo-50/50' : 'border-slate-200 bg-slate-50/50'
        }`}
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          const file = event.dataTransfer.files?.[0]
          if (file) void processFile(file)
        }}
      >
        <div className="mx-auto w-12 h-12 rounded-full bg-white border border-slate-200 flex items-center justify-center text-indigo-500 mb-4">
          <Upload size={22} />
        </div>
        <p className="text-sm font-medium text-slate-700">Drag and drop a CSV or Excel file</p>
        <p className="text-xs text-slate-400 mt-1">Maximum 10,000 rows</p>
        <div className="mt-4 flex items-center justify-center gap-3">
          <Button onClick={() => inputRef.current?.click()} loading={loading}>
            <FileSpreadsheet size={15} />
            Choose File
          </Button>
          <Button variant="outline" onClick={() => void downloadTemplate('csv')}>
            <Download size={15} />
            CSV Template
          </Button>
          <Button variant="outline" onClick={() => void downloadTemplate('xlsx')}>
            <Download size={15} />
            Excel Template
          </Button>
        </div>
        <p className="text-xs text-slate-400 mt-3">
          Use the official hisab.ai template for automatic column mapping, or upload any CSV/Excel export.
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.xlsx"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void processFile(file)
          }}
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  )
}
