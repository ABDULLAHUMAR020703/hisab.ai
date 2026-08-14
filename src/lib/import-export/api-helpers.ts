import { NextResponse } from 'next/server'
import { TenantAccessError } from '@/lib/tenant-error'
import { FrameworkBadRequestError, FrameworkNotFoundError } from './errors'
import { ForbiddenError } from '@/lib/authz'
import { AccountingIntegrationException } from '@/integrations/accounting/utils/exceptions'

export function apiError(error: unknown, fallback = 'Request failed') {
  if (error instanceof AccountingIntegrationException) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.statusCode },
    )
  }
  if (error instanceof FrameworkNotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 })
  }
  if (error instanceof FrameworkBadRequestError) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
  if (error instanceof TenantAccessError) {
    return NextResponse.json({ error: error.message }, { status: 403 })
  }
  if (error instanceof ForbiddenError) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (error instanceof Error) {
    if (error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.json({ error: error.message || fallback }, { status: 400 })
  }
  return NextResponse.json({ error: fallback }, { status: 500 })
}

export function parseBooleanParam(value: string | null, defaultValue = false): boolean {
  if (value === null) return defaultValue
  return value === 'true' || value === '1'
}

export function parseListParam(value: string | null): string[] {
  if (!value?.trim()) return []
  return value.split(',').map((item) => item.trim()).filter(Boolean)
}
