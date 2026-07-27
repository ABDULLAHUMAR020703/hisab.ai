'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface ActionDropdownItem {
  label: string
  onSelect: () => void
  disabled?: boolean
  danger?: boolean
}

export function ActionDropdown({ label = 'Edit', items, align = 'right' }: { label?: ReactNode; items: ActionDropdownItem[]; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => { if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  return (
    <div ref={ref} className="relative inline-flex" onClick={(event) => event.stopPropagation()}>
      <button type="button" onClick={() => setOpen((value) => !value)} aria-haspopup="menu" aria-expanded={open}
        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-indigo-600 hover:bg-indigo-50">
        {label}<ChevronDown size={13} />
      </button>
      {open && (
        <div role="menu" className={cn('absolute top-full z-40 mt-1 min-w-36 rounded-xl border border-slate-200 bg-white p-1 shadow-lg', align === 'right' ? 'right-0' : 'left-0')}>
          {items.filter((item) => !item.disabled).map((item) => (
            <button key={item.label} type="button" role="menuitem" onClick={() => { setOpen(false); item.onSelect() }}
              className={cn('block w-full rounded-lg px-3 py-2 text-left text-xs font-medium hover:bg-slate-50', item.danger ? 'text-red-600' : 'text-slate-700')}>
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
