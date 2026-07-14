'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { PageHeader } from '@/components/ui/page-header'

interface DocumentRow {
  id: string
  name: string
  status?: string
  current_version?: number
  category?: { name?: string }
  created_at?: string
}

export default function PlatformDocumentsPage() {
  const [documents, setDocuments] = useState<DocumentRow[]>([])

  useEffect(() => {
    fetch('/api/platform/documents')
      .then((r) => r.json())
      .then((d) => setDocuments(d.documents ?? []))
  }, [])

  return (
    <div className="p-6 max-w-[1100px] mx-auto space-y-6">
      <PageHeader
        title="Document Management"
        subtitle="Versioning, categories, tags, OCR metadata, comments, and retention"
        breadcrumb={[{ label: 'Platform' }, { label: 'Documents' }]}
        action={<Link href="/platform" className="text-sm text-indigo-600 hover:underline">← Platform</Link>}
      />
      <div className="rounded-xl border divide-y">
        {documents.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">No documents yet. Legacy uploads at /api/documents remain supported.</div>
        ) : documents.map((doc) => (
          <div key={doc.id} className="p-4 flex items-center justify-between hover:bg-slate-50">
            <div>
              <div className="font-medium">{doc.name}</div>
              <div className="text-xs text-muted-foreground">
                {doc.category?.name ?? 'Uncategorized'} · v{doc.current_version ?? 1} · {doc.status ?? 'ACTIVE'}
              </div>
            </div>
            <span className="text-xs text-muted-foreground">{doc.created_at?.slice(0, 10)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
