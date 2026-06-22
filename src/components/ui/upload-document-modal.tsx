'use client'

import { useState, useRef } from 'react'
import { Upload, FileText, CheckCircle, X } from 'lucide-react'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { readApiError } from '@/lib/api-client'

interface Props {
  open: boolean
  onClose: () => void
  onSuccess?: () => void
  title?: string
}

export function UploadDocumentModal({ open, onClose, onSuccess, title = 'Upload Bill Document' }: Props) {
  const [file, setFile] = useState<File | null>(null)
  const [vendor, setVendor] = useState('')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [uploading, setUploading] = useState(false)
  const [done, setDone] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  function handleFile(f: File) { setFile(f) }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    const f = e.dataTransfer.files[0]
    if (f) handleFile(f)
  }

  function reset() {
    setFile(null); setVendor(''); setAmount(''); setDescription(''); setDone(false)
  }

  function handleClose() { reset(); onClose() }

  async function handleUpload() {
    if (!file) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      if (vendor) fd.append('vendor', vendor)
      if (amount) fd.append('amount', amount)
      if (description) fd.append('description', description)

      const res = await fetch('/api/receipts', { method: 'POST', body: fd })
      if (!res.ok) {
        alert(await readApiError(res))
        return
      }
      if (res.ok) {
        setDone(true)
        onSuccess?.()
      }
    } finally {
      setUploading(false)
    }
  }

  return (
    <Modal open={open} onClose={handleClose} title={title} size="md"
      footer={
        done ? (
          <Button variant="outline" onClick={handleClose}>Close</Button>
        ) : (
          <>
            <Button variant="outline" onClick={handleClose}>Cancel</Button>
            <Button onClick={handleUpload} loading={uploading} disabled={!file}>
              <Upload size={14} /> Upload
            </Button>
          </>
        )
      }
    >
      <div className="space-y-4">
        {!done ? (
          <>
            {/* Drop zone */}
            <div
              onDrop={handleDrop}
              onDragOver={e => e.preventDefault()}
              onClick={() => !file && fileRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${file ? 'border-indigo-300 bg-indigo-50/40' : 'border-slate-300 cursor-pointer hover:border-indigo-400 hover:bg-indigo-50/30'}`}
            >
              {file ? (
                <div className="flex items-center justify-center gap-3">
                  <FileText size={22} className="text-indigo-500" />
                  <div className="text-left">
                    <p className="text-sm font-semibold text-slate-700">{file.name}</p>
                    <p className="text-xs text-slate-400">{(file.size / 1024).toFixed(1)} KB</p>
                  </div>
                  <button onClick={e => { e.stopPropagation(); setFile(null) }} className="ml-2 p-1 text-slate-400 hover:text-slate-600 rounded">
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <>
                  <Upload size={28} className="mx-auto mb-2 text-slate-300" />
                  <p className="text-sm font-semibold text-slate-600">Drop file here or click to browse</p>
                  <p className="text-xs text-slate-400 mt-1">PDF, JPG, PNG supported</p>
                </>
              )}
              <input
                ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Input label="Vendor Name" value={vendor} onChange={e => setVendor(e.target.value)} placeholder="Optional" />
              <Input label="Amount" type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="Optional" />
            </div>
            <Input label="Description" value={description} onChange={e => setDescription(e.target.value)} placeholder="Brief description of the document" />
          </>
        ) : (
          <div className="flex items-center gap-3 p-4 rounded-xl bg-emerald-50 border border-emerald-200">
            <CheckCircle size={20} className="text-emerald-500 shrink-0" />
            <p className="text-sm font-semibold text-emerald-700">Document uploaded successfully</p>
          </div>
        )}
      </div>
    </Modal>
  )
}
