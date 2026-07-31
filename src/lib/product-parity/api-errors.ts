import { authzErrorResponse, ForbiddenError } from '@/lib/authz'
import { ProductParityValidationError } from './validation'

export function productParityErrorResponse(error: unknown) {
  if (error instanceof ProductParityValidationError) return Response.json({ error: error.message, code: error.code }, { status: 400 })
  if (error instanceof ForbiddenError || (error instanceof Error && error.message === 'Unauthorized')) return authzErrorResponse(error)
  const message = error instanceof Error ? error.message : String(error)
  return Response.json({ error: message }, { status: /not found/i.test(message) ? 404 : 400 })
}
