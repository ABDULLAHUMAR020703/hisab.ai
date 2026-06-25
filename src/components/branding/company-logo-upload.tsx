'use client'

import { useEffect, useRef, useState } from 'react'
import { ImageIcon, Trash2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  COMPANY_LOGO_ALLOWED_EXTENSIONS,
  COMPANY_LOGO_MAX_BYTES,
} from '@/lib/branding/constants'
import { stripLogoCacheBuster, withLogoCacheBuster } from '@/lib/branding/logo-url'

interface CompanyLogoUploadProps {
  logoUrl: string | null
  logoUploadedAt: string | null
  onLogoChange: (logo: { logoUrl: string | null; logoUploadedAt: string | null }) => void
}

function formatFileSize(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function CompanyLogoUpload({
  logoUrl,
  logoUploadedAt,
  onLogoChange,
}: CompanyLogoUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const localPreviewRef = useRef<string | null>(null)
  const [localPreview, setLocalPreview] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const serverDisplayUrl = withLogoCacheBuster(logoUrl, logoUploadedAt)
  const displayUrl = localPreview ?? serverDisplayUrl
  const hasLogo = Boolean(logoUrl || localPreview)

  useEffect(() => {
    return () => {
      if (localPreviewRef.current) {
        URL.revokeObjectURL(localPreviewRef.current)
        localPreviewRef.current = null
      }
    }
  }, [])

  function clearLocalPreview() {
    if (localPreviewRef.current) {
      URL.revokeObjectURL(localPreviewRef.current)
      localPreviewRef.current = null
    }
    setLocalPreview(null)
  }

  function openFilePicker() {
    inputRef.current?.click()
  }

  function uploadWithProgress(file: File): Promise<{
    logoUrl: string | null
    logoStoragePath: string | null
    logoUploadedAt: string
  }> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      const formData = new FormData()
      formData.append('file', file)

      xhr.upload.addEventListener('progress', (event) => {
        if (!event.lengthComputable) return
        setProgress(Math.round((event.loaded / event.total) * 100))
      })

      xhr.addEventListener('load', () => {
        try {
          const payload = JSON.parse(xhr.responseText)
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(payload)
            return
          }
          reject(new Error(payload.error || 'Upload failed'))
        } catch {
          reject(new Error('Upload failed'))
        }
      })

      xhr.addEventListener('error', () => reject(new Error('Upload failed')))
      xhr.open('POST', '/api/settings/logo')
      xhr.send(formData)
    })
  }

  async function handleFileSelected(file: File | null) {
    if (!file) return

    setError(null)
    setProgress(0)

    if (file.size > COMPANY_LOGO_MAX_BYTES) {
      setError(`Logo must be ${formatFileSize(COMPANY_LOGO_MAX_BYTES)} or smaller.`)
      return
    }

    const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
    if (!COMPANY_LOGO_ALLOWED_EXTENSIONS.includes(extension as typeof COMPANY_LOGO_ALLOWED_EXTENSIONS[number])) {
      setError('Logo must be PNG, JPG, JPEG, or SVG.')
      return
    }

    clearLocalPreview()
    const objectUrl = URL.createObjectURL(file)
    localPreviewRef.current = objectUrl
    setLocalPreview(objectUrl)
    setUploading(true)

    try {
      const result = await uploadWithProgress(file)
      const baseUrl = stripLogoCacheBuster(result.logoUrl)
      clearLocalPreview()
      onLogoChange({
        logoUrl: baseUrl,
        logoUploadedAt: result.logoUploadedAt,
      })
    } catch (err) {
      clearLocalPreview()
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
      setProgress(0)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function handleRemove() {
    setError(null)
    setRemoving(true)
    try {
      const res = await fetch('/api/settings/logo', { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to remove logo')

      clearLocalPreview()
      onLogoChange({ logoUrl: null, logoUploadedAt: null })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove logo')
    } finally {
      setRemoving(false)
    }
  }

  return (
    <div className="space-y-4">
      <input
        ref={inputRef}
        type="file"
        accept=".png,.jpg,.jpeg,.svg,image/png,image/jpeg,image/svg+xml"
        className="hidden"
        onChange={(e) => void handleFileSelected(e.target.files?.[0] ?? null)}
      />

      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex h-28 w-full sm:w-40 items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 overflow-hidden">
          {displayUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={displayUrl}
              src={displayUrl}
              alt="Company logo preview"
              className="max-h-24 max-w-[9.5rem] object-contain"
            />
          ) : (
            <div className="flex flex-col items-center gap-1 text-slate-400">
              <ImageIcon size={24} />
              <span className="text-xs">No logo uploaded</span>
            </div>
          )}
        </div>

        <div className="flex-1 space-y-3">
          <div>
            <p className="text-sm font-medium text-slate-800">Company Logo</p>
            <p className="text-xs text-slate-400 mt-1">
              PNG, JPG, JPEG, or SVG · max {formatFileSize(COMPANY_LOGO_MAX_BYTES)} · used on invoices and future documents
            </p>
            {logoUploadedAt && (
              <p className="text-xs text-slate-500 mt-1">
                Uploaded {new Date(logoUploadedAt).toLocaleString()}
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={openFilePicker}
              loading={uploading}
            >
              <Upload size={14} />
              {hasLogo ? 'Replace logo' : 'Upload logo'}
            </Button>
            {hasLogo && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void handleRemove()}
                loading={removing}
                className="text-red-600 hover:text-red-700 hover:bg-red-50"
              >
                <Trash2 size={14} />
                Remove logo
              </Button>
            )}
          </div>

          {uploading && (
            <div className="space-y-1">
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-indigo-500 transition-all duration-150"
                  style={{ width: `${Math.max(progress, 8)}%` }}
                />
              </div>
              <p className="text-xs text-slate-500">Uploading… {progress}%</p>
            </div>
          )}

          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}
        </div>
      </div>
    </div>
  )
}
