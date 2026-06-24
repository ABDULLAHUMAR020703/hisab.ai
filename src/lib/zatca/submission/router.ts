import type { InvoiceType, ZatcaEnvironment } from '@/lib/db/prisma-types'
import { resolveSubmissionRoute, type ZatcaSubmissionRoute } from './types'

export function getSubmissionRoute(
  invoiceType: InvoiceType,
  environment: ZatcaEnvironment = 'SANDBOX',
): ZatcaSubmissionRoute {
  return resolveSubmissionRoute(invoiceType, environment)
}

export function getSubmissionRouteLabel(route: ZatcaSubmissionRoute): string {
  return route === 'clearance' ? 'Clearance API' : 'Reporting API'
}
