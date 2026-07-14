'use client'

import { useEffect, useState } from 'react'
import { CheckCircle, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { readApiError } from '@/lib/api-client'

const STEP_LABELS: Record<string, string> = {
  COA_TEMPLATE: 'Chart of Accounts',
  OPENING_BALANCES: 'Opening Balances',
  IMPORT_DATA: 'Import Data',
  REVIEW: 'Review',
  COMPLETE: 'Complete',
}

interface WizardSession {
  id: string
  step: string
  status: string
  config: Record<string, unknown>
}

interface Account { id: string; accountNo: string; name: string }

export default function MigrationWizardPage() {
  const [session, setSession] = useState<WizardSession | null>(null)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [openingLines, setOpeningLines] = useState([
    { accountId: '', debit: 0, credit: 0, description: 'Opening balance' },
    { accountId: '', debit: 0, credit: 0, description: 'Opening balance' },
  ])

  async function loadSession() {
    setLoading(true)
    const [wRes, aRes] = await Promise.all([
      fetch('/api/migration-wizard'),
      fetch('/api/accounts'),
    ])
    if (wRes.ok) setSession(await wRes.json())
    if (aRes.ok) setAccounts(await aRes.json())
    setLoading(false)
  }

  useEffect(() => { loadSession() }, [])

  async function advanceStep() {
    setSaving(true)
    const res = await fetch('/api/migration-wizard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'advance' }),
    })
    if (!res.ok) alert(await readApiError(res))
    else setSession(await res.json())
    setSaving(false)
  }

  async function postOpeningBalances() {
    setSaving(true)
    const lines = openingLines.filter(l => l.accountId && (l.debit > 0 || l.credit > 0))
    const res = await fetch('/api/migration-wizard/opening-balances', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'Migration opening balances', lines }),
    })
    if (!res.ok) alert(await readApiError(res))
    else await advanceStep()
    setSaving(false)
  }

  const steps = Object.keys(STEP_LABELS)
  const currentIdx = session ? steps.indexOf(session.step) : 0

  if (loading) {
    return <div className="p-6 text-slate-500">Loading wizard...</div>
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Migration Wizard</h1>
        <p className="text-slate-500 text-sm mt-0.5">Set up your books when moving from another system</p>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {steps.map((step, idx) => (
          <div key={step} className="flex items-center gap-2">
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold ${
              idx < currentIdx ? 'bg-emerald-50 text-emerald-700' :
              idx === currentIdx ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-400'
            }`}>
              {idx < currentIdx ? <CheckCircle size={14} /> : null}
              {STEP_LABELS[step]}
            </div>
            {idx < steps.length - 1 && <ChevronRight size={14} className="text-slate-300" />}
          </div>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
        {session?.step === 'COA_TEMPLATE' && (
          <>
            <p className="text-sm text-slate-600">Confirm your chart of accounts is ready. Import accounts from Settings or Master Data if needed.</p>
            <Button onClick={advanceStep} loading={saving}>Continue</Button>
          </>
        )}

        {session?.step === 'OPENING_BALANCES' && (
          <>
            <p className="text-sm text-slate-600">Enter opening balances. Debits must equal credits.</p>
            <div className="space-y-2">
              {openingLines.map((line, idx) => (
                <div key={idx} className="grid grid-cols-4 gap-2">
                  <select
                    value={line.accountId}
                    onChange={e => setOpeningLines(lines => lines.map((l, i) => i === idx ? { ...l, accountId: e.target.value } : l))}
                    className="input-base col-span-2 text-xs"
                  >
                    <option value="">Account</option>
                    {accounts.map(a => <option key={a.id} value={a.id}>{a.accountNo} — {a.name}</option>)}
                  </select>
                  <input type="number" min="0" placeholder="Debit" value={line.debit || ''} onChange={e => setOpeningLines(lines => lines.map((l, i) => i === idx ? { ...l, debit: parseFloat(e.target.value) || 0 } : l))} className="input-base text-xs" />
                  <input type="number" min="0" placeholder="Credit" value={line.credit || ''} onChange={e => setOpeningLines(lines => lines.map((l, i) => i === idx ? { ...l, credit: parseFloat(e.target.value) || 0 } : l))} className="input-base text-xs" />
                </div>
              ))}
            </div>
            <button onClick={() => setOpeningLines(l => [...l, { accountId: '', debit: 0, credit: 0, description: 'Opening balance' }])} className="text-xs text-indigo-600 font-medium">+ Add line</button>
            <Button onClick={postOpeningBalances} loading={saving}>Post Opening Balances</Button>
          </>
        )}

        {session?.step === 'IMPORT_DATA' && (
          <>
            <p className="text-sm text-slate-600">Import customers, vendors, and transactions using Import History or module CSV imports.</p>
            <Button onClick={advanceStep} loading={saving}>Continue</Button>
          </>
        )}

        {session?.step === 'REVIEW' && (
          <>
            <p className="text-sm text-slate-600">Review trial balance and reports before going live.</p>
            <Button onClick={advanceStep} loading={saving}>Complete Migration</Button>
          </>
        )}

        {session?.step === 'COMPLETE' && (
          <div className="text-center py-6">
            <CheckCircle size={40} className="mx-auto text-emerald-500 mb-3" />
            <p className="font-semibold text-slate-800">Migration complete</p>
            <p className="text-sm text-slate-500 mt-1">Your company is ready to use {session.status === 'COMPLETED' ? 'hisab.ai' : 'the app'}.</p>
          </div>
        )}
      </div>
    </div>
  )
}
