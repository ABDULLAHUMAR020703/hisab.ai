'use client'

import { useState } from 'react'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { readApiError } from '@/lib/api-client'

interface MappingTemplateDialogProps {
  open: boolean
  onClose: () => void
  moduleKey: string
  mapping: Record<string, string | null>
  headerFingerprint: string
}

export function MappingTemplateDialog({
  open,
  onClose,
  moduleKey,
  mapping,
  headerFingerprint,
}: MappingTemplateDialogProps) {
  const [name, setName] = useState('')
  const [isDefault, setIsDefault] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    if (!name.trim()) {
      setError('Template name is required')
      return
    }

    setSaving(true)
    setError(null)
    try {
      const columnMapping: Record<string, string> = {}
      for (const [source, target] of Object.entries(mapping)) {
        if (target) columnMapping[source] = target
      }

      const response = await fetch('/api/import-export/mapping-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          moduleKey,
          name: name.trim(),
          columnMapping,
          headerFingerprint,
          isDefault,
        }),
      })

      if (!response.ok) throw new Error(await readApiError(response))
      onClose()
      setName('')
      setIsDefault(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save template')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Save Mapping Template"
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void handleSave()} loading={saving}>Save Template</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Template Name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g. Standard customer import"
        />
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={isDefault}
            onChange={(event) => setIsDefault(event.target.checked)}
          />
          Set as default for matching file headers
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </Modal>
  )
}
