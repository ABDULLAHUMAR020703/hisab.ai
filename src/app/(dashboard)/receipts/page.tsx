'use client'

import { useEffect, useState, useRef } from 'react'
import { Upload, Camera, RefreshCw, FileImage } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { readApiError } from '@/lib/api-client'

interface Receipt {
  id: string; fileName: string; vendor?: string; amount?: number
  date?: string; description?: string; status: string; createdAt: string
  mimeType: string
}

export default function ReceiptsPage() {
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  async function load() {
    setLoading(true)
    const res = await fetch('/api/receipts')
    if (res.ok) setReceipts(await res.json())
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    const fd = new FormData()
    fd.append('file', file)
    const res = await fetch('/api/receipts', { method: 'POST', body: fd })
    if (!res.ok) {
      alert(await readApiError(res))
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
      return
    }
    if (res.ok) load()
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  const stats = {
    total: receipts.length,
    unprocessed: receipts.filter(r => r.status === 'UNPROCESSED').length,
    processed: receipts.filter(r => r.status === 'PROCESSED').length,
    matched: receipts.filter(r => r.status === 'MATCHED').length,
  }

  return (
    <div className="p-6 max-w-[1600px] mx-auto space-y-5">
      <PageHeader
        title="Receipt Scanner"
        subtitle={`${stats.total} receipts · ${stats.unprocessed} unprocessed`}
        breadcrumb={[{ label: 'Operations' }, { label: 'Receipts' }]}
        action={
          <div className="flex items-center gap-2">
            <input ref={fileRef} type="file" accept="image/*,application/pdf" onChange={handleUpload} className="hidden" />
            <Button variant="outline" onClick={() => fileRef.current?.click()} loading={uploading}>
              <Upload size={15} /> Upload Receipt
            </Button>
            <button onClick={load} className="p-2 border border-slate-200 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-50 bg-white transition-colors">
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total', value: stats.total, color: 'text-slate-700' },
          { label: 'Unprocessed', value: stats.unprocessed, color: 'text-amber-600' },
          { label: 'Processed', value: stats.processed, color: 'text-indigo-600' },
          { label: 'Matched', value: stats.matched, color: 'text-emerald-600' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-slate-200 px-4 py-3">
            <p className="text-xs text-slate-400 font-medium">{s.label}</p>
            <p className={cn('text-lg font-bold mt-0.5', s.color)}>{s.value}</p>
          </div>
        ))}
      </div>

      {receipts.length === 0 && !loading ? (
        <div
          onClick={() => fileRef.current?.click()}
          className="border-2 border-dashed border-slate-200 rounded-2xl p-16 flex flex-col items-center justify-center gap-4 text-center cursor-pointer hover:border-indigo-300 hover:bg-indigo-50/30 transition-all"
        >
          <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center">
            <Camera size={28} className="text-slate-400" />
          </div>
          <div>
            <p className="font-semibold text-slate-700 text-lg">Upload your first receipt</p>
            <p className="text-slate-400 text-sm mt-1">Click to upload or drag and drop · JPEG, PNG, PDF</p>
          </div>
          <Button><Upload size={14} /> Upload Receipt</Button>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {/* Upload card */}
          <div
            onClick={() => fileRef.current?.click()}
            className="border-2 border-dashed border-slate-200 rounded-2xl p-6 flex flex-col items-center justify-center gap-3 cursor-pointer hover:border-indigo-300 hover:bg-indigo-50/30 transition-all aspect-[3/4] min-h-[200px]"
          >
            <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center">
              <Upload size={20} className="text-slate-400" />
            </div>
            <p className="text-sm font-medium text-slate-500 text-center">Upload Receipt</p>
          </div>

          {loading ? Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-white rounded-2xl border border-slate-200 overflow-hidden aspect-[3/4] min-h-[200px]">
              <div className="skeleton h-full w-full" />
            </div>
          )) : receipts.map(r => (
            <div key={r.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden hover:shadow-md transition-shadow">
              <div className="bg-slate-100 h-40 flex items-center justify-center">
                <FileImage size={32} className="text-slate-300" />
              </div>
              <div className="p-3">
                <p className="text-xs font-semibold text-slate-700 truncate">{r.fileName}</p>
                {r.vendor && <p className="text-xs text-slate-500 mt-0.5">{r.vendor}</p>}
                {r.amount && <p className="text-xs font-bold text-indigo-600 mt-1">{r.amount?.toLocaleString('en-SA', { style: 'currency', currency: 'SAR' })}</p>}
                <div className="mt-2">
                  <Badge status={r.status} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
