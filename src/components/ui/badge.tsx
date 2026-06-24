import { cn } from '@/lib/utils'

const variants: Record<string, string> = {
  DRAFT:    'bg-slate-100 text-slate-600 border border-slate-200',
  PENDING:  'bg-amber-50 text-amber-700 border border-amber-200',
  SENT:     'bg-blue-50 text-blue-700 border border-blue-200',
  APPROVED: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  PAID:     'bg-green-50 text-green-700 border border-green-200',
  PARTIAL:  'bg-violet-50 text-violet-700 border border-violet-200',
  OVERDUE:  'bg-red-50 text-red-700 border border-red-200',
  VOID:     'bg-gray-50 text-gray-400 border border-gray-200',
  REJECTED: 'bg-red-50 text-red-600 border border-red-200',
  ACTIVE:   'bg-emerald-50 text-emerald-700 border border-emerald-200',
  INACTIVE: 'bg-gray-50 text-gray-500 border border-gray-200',
  POSTED:   'bg-indigo-50 text-indigo-700 border border-indigo-200',
  UNPROCESSED: 'bg-gray-50 text-gray-500 border border-gray-200',
  PROCESSED:   'bg-blue-50 text-blue-700 border border-blue-200',
  MATCHED:     'bg-green-50 text-green-700 border border-green-200',
  VAT:      'bg-indigo-50 text-indigo-700 border border-indigo-200',
  MONTHLY:  'bg-slate-50 text-slate-600 border border-slate-200',
  CLEARED:  'bg-emerald-50 text-emerald-700 border border-emerald-200',
  REPORTED: 'bg-blue-50 text-blue-700 border border-blue-200',
  SUBMITTED:'bg-indigo-50 text-indigo-700 border border-indigo-200',
  FAILED:   'bg-red-50 text-red-700 border border-red-200',
  'NOT SUBMITTED': 'bg-slate-50 text-slate-600 border border-slate-200',
  default:  'bg-gray-100 text-gray-600 border border-gray-200',
}

const zatcaVariants: Record<string, string> = {
  DRAFT: 'bg-slate-50 text-slate-600 border border-slate-200',
  PENDING: 'bg-amber-50 text-amber-700 border border-amber-200',
  SUBMITTED: 'bg-indigo-50 text-indigo-700 border border-indigo-200',
  CLEARED: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  REPORTED: 'bg-blue-50 text-blue-700 border border-blue-200',
  FAILED: 'bg-red-50 text-red-700 border border-red-200',
  REJECTED: 'bg-red-50 text-red-600 border border-red-200',
}

export function Badge({ status, label, className }: { status?: string; label?: string; className?: string }) {
  const key = status || label || ''
  const style = variants[key.toUpperCase()] || variants.default
  return (
    <span className={cn('badge', style, className)}>
      {label || status}
    </span>
  )
}

export function ZatcaBadge({ status, className }: { status?: string | null; className?: string }) {
  const key = (status || 'DRAFT').toUpperCase()
  const label = key === 'DRAFT' ? 'Not Submitted' : key.replaceAll('_', ' ')
  const style = zatcaVariants[key] || variants.default
  return (
    <span className={cn('badge', style, className)}>
      {label}
    </span>
  )
}

export function BusinessBadge({ status, className }: { status?: string; className?: string }) {
  return <Badge status={status} className={className} />
}

export function StatusDot({ status }: { status: string }) {
  const dots: Record<string, string> = {
    PAID: 'bg-green-500', SENT: 'bg-blue-500', DRAFT: 'bg-slate-400',
    OVERDUE: 'bg-red-500', PARTIAL: 'bg-violet-500', APPROVED: 'bg-emerald-500',
    POSTED: 'bg-indigo-500', PENDING: 'bg-amber-500',
  }
  return <span className={cn('inline-block w-1.5 h-1.5 rounded-full mr-1.5', dots[status] || 'bg-gray-400')} />
}
