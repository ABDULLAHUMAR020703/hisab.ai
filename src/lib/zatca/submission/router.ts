import type { InvoiceType } from '@/lib/db/prisma-types'
import { resolveSubmissionRoute, type ZatcaSubmissionRoute } from './types'

export function getSubmissionRoute(invoiceType: InvoiceType): ZatcaSubmissionRoute {
  return resolveSubmissionRoute(invoiceType)
}

export function getSubmissionRouteLabel(route: ZatcaSubmissionRoute): string {
  return route === 'clearance' ? 'Clearance API' : 'Reporting API'
}
