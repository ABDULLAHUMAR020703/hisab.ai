'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { readApiError } from '@/lib/api-client'
import { applyColumnMapping } from '@/lib/import-export/mapping/auto-mapper'
import type { DuplicateStrategy, DuplicateMatch, FieldDefinition, ValidationResult } from '@/lib/import-export/types'
import { UploadStep } from './steps/UploadStep'
import { MappingStep, isMappingComplete } from './steps/MappingStep'
import { PreviewStep } from './steps/PreviewStep'
import { ValidationSummary } from './ValidationSummary'
import { DuplicateStep } from './steps/DuplicateStep'
import { MappingTemplateDialog } from './MappingTemplateDialog'

type WizardStep =
  | 'upload'
  | 'mapping'
  | 'preview'
  | 'validation'
  | 'duplicates'
  | 'importing'
  | 'complete'

interface ImportWizardProps {
  open: boolean
  onClose: () => void
  onSuccess?: () => void
  moduleKey: string
  moduleLabel: string
  fields: FieldDefinition[]
}

const STEPS: WizardStep[] = ['upload', 'mapping', 'preview', 'validation', 'duplicates', 'importing', 'complete']

export function ImportWizard({
  open,
  onClose,
  onSuccess,
  moduleKey,
  moduleLabel,
  fields,
}: ImportWizardProps) {
  const [step, setStep] = useState<WizardStep>('upload')
  const [filename, setFilename] = useState('')
  const [fileFormat, setFileFormat] = useState<'csv' | 'xlsx'>('csv')
  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows] = useState<Record<string, string>[]>([])
  const [mapping, setMapping] = useState<Record<string, string | null>>({})
  const [headerFingerprint, setHeaderFingerprint] = useState('')
  const [validation, setValidation] = useState<ValidationResult | null>(null)
  const [mappedPreview, setMappedPreview] = useState<Array<{ rowNumber: number; mapped: Record<string, unknown> }>>([])
  const [duplicateMatches, setDuplicateMatches] = useState<DuplicateMatch[]>([])
  const [duplicateStrategy, setDuplicateStrategy] = useState<DuplicateStrategy>('skip')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const [result, setResult] = useState<{
    importedCount: number
    updatedCount: number
    skippedCount: number
    failedCount: number
    totalRows: number
  } | null>(null)
  const [showTemplateDialog, setShowTemplateDialog] = useState(false)
  const [skipMapping, setSkipMapping] = useState(false)
  const [officialTemplateId, setOfficialTemplateId] = useState<string | null>(null)
  const [officialTemplateName, setOfficialTemplateName] = useState<string | null>(null)

  function reset() {
    setStep('upload')
    setFilename('')
    setFileFormat('csv')
    setHeaders([])
    setRows([])
    setMapping({})
    setHeaderFingerprint('')
    setValidation(null)
    setMappedPreview([])
    setDuplicateMatches([])
    setDuplicateStrategy('skip')
    setLoading(false)
    setError(null)
    setJobId(null)
    setResult(null)
    setSkipMapping(false)
    setOfficialTemplateId(null)
    setOfficialTemplateName(null)
  }

  function handleClose() {
    reset()
    onClose()
  }

  async function runValidation() {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/import-export/${moduleKey}/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows, mapping, officialTemplateId }),
      })
      if (!response.ok) throw new Error(await readApiError(response))
      const payload = await response.json()
      setValidation(payload.validation)
      setMappedPreview(payload.previewRows ?? [])
      setDuplicateMatches(payload.duplicates ?? [])
      setStep('validation')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Validation failed')
    } finally {
      setLoading(false)
    }
  }

  async function runImport() {
    setStep('importing')
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/import-export/${moduleKey}/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rows,
          mapping,
          filename,
          fileFormat,
          duplicateStrategy,
          duplicates: duplicateMatches,
          officialTemplateId,
        }),
      })
      if (!response.ok) throw new Error(await readApiError(response))
      const payload = await response.json()
      setJobId(payload.jobId)
      setResult({
        importedCount: payload.importedCount,
        updatedCount: payload.updatedCount,
        skippedCount: payload.skippedCount,
        failedCount: payload.failedCount,
        totalRows: payload.totalRows,
      })
      setStep('complete')
      onSuccess?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
      setStep('duplicates')
    } finally {
      setLoading(false)
    }
  }

  const stepIndex = STEPS.indexOf(step)
  const stepTitle = {
    upload: 'Upload File',
    mapping: 'Column Mapping',
    preview: 'Preview',
    validation: 'Validation Summary',
    duplicates: 'Duplicate Strategy',
    importing: 'Importing',
    complete: 'Import Complete',
  }[step]

  const previewMappedRows = applyColumnMapping(rows, mapping).slice(0, 20)

  const footer = step === 'complete' ? (
    <>
      {jobId && (
        <Link href={`/import-history?id=${jobId}`} className="mr-auto text-sm text-indigo-600 hover:text-indigo-800 font-medium">
          View in Import History
        </Link>
      )}
      <Button onClick={handleClose}>Close</Button>
    </>
  ) : (
    <>
      <Button variant="outline" onClick={handleClose}>Cancel</Button>
      {step === 'upload' && null}
      {step === 'mapping' && (
        <>
          <Button variant="outline" onClick={() => setShowTemplateDialog(true)}>Save Mapping</Button>
          <Button
            onClick={() => setStep('preview')}
            disabled={!isMappingComplete(fields, mapping)}
          >
            Continue
          </Button>
        </>
      )}
      {step === 'preview' && (
        <>
          <Button variant="outline" onClick={() => setStep(skipMapping ? 'upload' : 'mapping')}>Back</Button>
          <Button onClick={() => void runValidation()} loading={loading}>Validate</Button>
        </>
      )}
      {step === 'validation' && (
        <>
          <Button variant="outline" onClick={() => setStep('preview')}>Back</Button>
          <Button
            onClick={() => setStep('duplicates')}
            disabled={!validation || validation.validRowNumbers.length === 0}
          >
            Continue Import
          </Button>
        </>
      )}
      {step === 'duplicates' && (
        <>
          <Button variant="outline" onClick={() => setStep('validation')}>Back</Button>
          <Button onClick={() => void runImport()} loading={loading}>Start Import</Button>
        </>
      )}
    </>
  )

  return (
    <>
      <Modal
        open={open}
        onClose={handleClose}
        title={`Import ${moduleLabel}`}
        subtitle={`Step ${Math.min(stepIndex + 1, 7)} of 7 — ${stepTitle}${officialTemplateName && skipMapping ? ` · ${officialTemplateName}` : ''}`}
        size="2xl"
        footer={footer}
      >
        <div className="space-y-4">
          <div className="flex gap-2">
            {STEPS.slice(0, 6).map((item, index) => (
              <div
                key={item}
                className={`h-1.5 flex-1 rounded-full ${
                  index <= stepIndex ? 'bg-indigo-500' : 'bg-slate-200'
                }`}
              />
            ))}
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          {step === 'upload' && (
            <UploadStep
              moduleKey={moduleKey}
              onParsed={(payload) => {
                setFilename(payload.filename)
                setFileFormat(payload.format)
                setHeaders(payload.headers)
                setRows(payload.rows)
                setMapping(payload.suggestedMapping)
                setHeaderFingerprint(payload.headerFingerprint)
                setOfficialTemplateId(payload.officialTemplateId)
                setOfficialTemplateName(payload.officialTemplateName)
                setSkipMapping(payload.skipMapping)
                setStep(payload.skipMapping ? 'preview' : 'mapping')
              }}
            />
          )}

          {step === 'preview' && officialTemplateName && skipMapping && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              Official template recognized: <span className="font-semibold">{officialTemplateName}</span>.
              Column mapping was skipped.
            </div>
          )}

          {step === 'mapping' && (
            <MappingStep
              headers={headers}
              fields={fields}
              mapping={mapping}
              onChange={setMapping}
            />
          )}

          {step === 'preview' && (
            <PreviewStep
              headers={headers}
              rows={rows}
              mappedPreview={previewMappedRows}
            />
          )}

          {step === 'validation' && validation && (
            <div className="space-y-4">
              <ValidationSummary validation={validation} />
              {validation.errorCount > 0 && (
                <p className="text-sm text-slate-600">
                  Rows with errors will be skipped. Continue importing the remaining valid rows?
                </p>
              )}
            </div>
          )}

          {step === 'duplicates' && (
            <DuplicateStep
              duplicateCount={duplicateMatches.length}
              strategy={duplicateStrategy}
              onStrategyChange={setDuplicateStrategy}
            />
          )}

          {step === 'importing' && (
            <div className="py-12 text-center">
              <div className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent mb-4" />
              <p className="text-sm text-slate-600">Processing {rows.length} rows…</p>
            </div>
          )}

          {step === 'complete' && result && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  ['Imported', result.importedCount, 'text-emerald-700'],
                  ['Updated', result.updatedCount, 'text-blue-700'],
                  ['Skipped', result.skippedCount, 'text-amber-700'],
                  ['Failed', result.failedCount, 'text-red-700'],
                ].map(([label, value, color]) => (
                  <div key={label as string} className="rounded-xl border border-slate-200 p-4 text-center">
                    <p className="text-xs uppercase tracking-wide text-slate-400">{label as string}</p>
                    <p className={`text-2xl font-bold mt-1 ${color as string}`}>{value as number}</p>
                  </div>
                ))}
              </div>
              {result.failedCount > 0 && jobId && (
                <a
                  href={`/api/import-export/history/${jobId}/errors?format=csv`}
                  className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
                >
                  Download Error Report
                </a>
              )}
            </div>
          )}
        </div>
      </Modal>

      <MappingTemplateDialog
        open={showTemplateDialog}
        onClose={() => setShowTemplateDialog(false)}
        moduleKey={moduleKey}
        mapping={mapping}
        headerFingerprint={headerFingerprint}
      />
    </>
  )
}
