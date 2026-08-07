import 'server-only'
import { findSystemAccount } from '@/lib/accounting/posting-service'
import type { PostingLine } from '@/lib/accounting/posting-service'
import type { ComputedTaxComponent } from './calculator'

export interface TaxJournalContext {
  companyId: string
  documentNo: string
  documentType: 'INVOICE' | 'BILL' | 'EXPENSE' | 'VENDOR_CREDIT' | 'SALES_RECEIPT'
  isSales: boolean
  components: ComputedTaxComponent[]
}

/** Build automatic tax journal lines from computed tax components. */
export async function buildTaxJournalLines(ctx: TaxJournalContext): Promise<PostingLine[]> {
  const lines: PostingLine[] = []
  const vatPayable = await findSystemAccount(ctx.companyId, { nameContains: 'VAT Payable' })
  const vatReceivable = await findSystemAccount(ctx.companyId, { nameContains: 'VAT Receivable' })
  const withholdingPayable = await findSystemAccount(ctx.companyId, { nameContains: 'Withholding' })

  for (const component of ctx.components) {
    if (component.taxAmount <= 0) continue

    const desc = `${component.name} ${ctx.documentNo}`
    const amount = component.taxAmount

    if (component.isWithholding) {
      if (withholdingPayable) {
        lines.push({
          accountId: withholdingPayable,
          credit: ctx.isSales ? amount : 0,
          debit: ctx.isSales ? 0 : amount,
          description: `WHT ${desc}`,
        })
      }
      continue
    }

    if (component.isReverseCharge) {
      if (vatReceivable && vatPayable) {
        lines.push({ accountId: vatReceivable, debit: amount, description: `RC VAT ${desc}` })
        lines.push({ accountId: vatPayable, credit: amount, description: `RC VAT ${desc}` })
      }
      continue
    }

    if (ctx.isSales && vatPayable) {
      lines.push({ accountId: vatPayable, credit: amount, description: desc })
    } else if (!ctx.isSales && vatReceivable) {
      lines.push({ accountId: vatReceivable, debit: amount, description: desc })
    }
  }

  return lines
}
