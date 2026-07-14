'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Save, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import { readApiError } from '@/lib/api-client'

interface CatalogEntry { key: string; title: string; category: string }
interface Definition { id: string; name: string; base_report_key: string; is_shared: boolean }

export default function ReportBuilderPage() {
  const [catalog, setCatalog] = useState<CatalogEntry[]>([])
  const [definitions, setDefinitions] = useState<Definition[]>([])
  const [name, setName] = useState('')
  const [baseReportKey, setBaseReportKey] = useState('profit-loss')
  const [groupField, setGroupField] = useState('')
  const [sortField, setSortField] = useState('amount')
  const [formula, setFormula] = useState('{actual}-{budget}')
  const [saving, setSaving] = useState(false)

  async function loadDefinitions() {
    const res = await fetch('/api/reporting/definitions')
    if (res.ok) {
      const data = await res.json()
      setDefinitions(data.definitions ?? [])
    }
  }

  useEffect(() => {
    fetch('/api/reporting/catalog').then((r) => r.json()).then((d) => setCatalog(d.reports ?? []))
    loadDefinitions()
  }, [])

  async function saveDefinition() {
    if (!name.trim()) return
    setSaving(true)
    const res = await fetch('/api/reporting/definitions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        baseReportKey,
        grouping: groupField ? [{ field: groupField }] : [],
        sorting: [{ field: sortField, direction: 'desc' }],
        calculatedColumns: formula ? [{ key: 'calculated', label: 'Calculated', formula }] : [],
        isShared: true,
      }),
    })
    if (!res.ok) alert(await readApiError(res))
    else {
      setName('')
      await loadDefinitions()
    }
    setSaving(false)
  }

  return (
    <div className="p-6 max-w-[1200px] mx-auto space-y-6">
      <PageHeader
        title="Custom Report Builder"
        subtitle="Design saved reports with grouping, sorting, and calculated columns"
        breadcrumb={[{ label: 'Reports' }, { label: 'Builder' }]}
        action={(
          <Link href="/reports/enterprise" className="inline-flex items-center h-9 px-4 text-sm rounded-lg border border-slate-200 bg-white hover:bg-slate-50">
            Enterprise Reports
          </Link>
        )}
      />

      <div className="rounded-xl border bg-card p-5 space-y-4">
        <h3 className="font-semibold">New custom report</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Input placeholder="Report name" value={name} onChange={(e) => setName(e.target.value)} />
          <select className="border rounded-lg px-3 py-2 text-sm" value={baseReportKey} onChange={(e) => setBaseReportKey(e.target.value)}>
            {catalog.map((r) => <option key={r.key} value={r.key}>{r.title}</option>)}
          </select>
          <Input placeholder="Group by field (e.g. category, bucket)" value={groupField} onChange={(e) => setGroupField(e.target.value)} />
          <Input placeholder="Sort by field" value={sortField} onChange={(e) => setSortField(e.target.value)} />
          <Input placeholder="Calculated formula e.g. {actual}-{budget}" value={formula} onChange={(e) => setFormula(e.target.value)} className="md:col-span-2" />
        </div>
        <Button onClick={saveDefinition} disabled={saving}>
          <Save className="w-4 h-4 mr-2" /> Save definition
        </Button>
      </div>

      <div className="rounded-xl border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left p-3">Name</th>
              <th className="text-left p-3">Base report</th>
              <th className="text-left p-3">Shared</th>
            </tr>
          </thead>
          <tbody>
            {definitions.length === 0 ? (
              <tr><td colSpan={3} className="p-6 text-center text-muted-foreground">No saved reports yet</td></tr>
            ) : definitions.map((d) => (
              <tr key={d.id} className="border-t">
                <td className="p-3 font-medium">{d.name}</td>
                <td className="p-3">{d.base_report_key}</td>
                <td className="p-3">{d.is_shared ? 'Yes' : 'No'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
