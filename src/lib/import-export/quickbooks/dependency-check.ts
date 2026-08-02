import 'server-only'
import { MissingDependencyError } from '../import/import-error'
import { parseQuickBooksRaw, resolveQuickBooksCustomerContext, resolveQuickBooksLocalId } from './migration-store'
import type { ImportContext } from '../types'

type Row = Record<string, unknown>
type Reference = { entityTypes: string[]; localTables: string[]; sourceId: string; label: string }

function object(value: unknown): Row { return value && typeof value === 'object' ? value as Row : {} }
function sourceId(value: unknown): string { return String(object(value).value ?? '').trim() }

function collectLineReferences(lines: unknown, output: Reference[]) {
  if (!Array.isArray(lines)) return
  for (const lineValue of lines) {
    const line = object(lineValue)
    const detail = object(line.SalesItemLineDetail ?? line.ItemBasedExpenseLineDetail ?? line.AccountBasedExpenseLineDetail ?? line.JournalEntryLineDetail ?? line.PurchaseItemLineDetail)
    const item = sourceId(detail.ItemRef)
    const account = sourceId(detail.AccountRef ?? line.AccountRef)
    const klass = sourceId(detail.ClassRef)
    if (item) output.push({ entityTypes:['Item'], localTables:['inventory_items'], sourceId:item, label:`item ${item}` })
    if (account) output.push({ entityTypes:['Account'], localTables:['chart_of_accounts'], sourceId:account, label:`account ${account}` })
    if (klass) output.push({ entityTypes:['Class'], localTables:['cost_centers'], sourceId:klass, label:`class ${klass}` })
  }
}

function referencesFor(moduleKey: string, raw: Row): Reference[] {
  const refs: Reference[] = []
  const customer = sourceId(raw.CustomerRef ?? raw.EntityRef)
  const vendor = sourceId(raw.VendorRef)
  const deposit = sourceId(raw.DepositToAccountRef)
  const ap = sourceId(raw.APAccountRef)
  const adjustment = sourceId(raw.AdjustmentAccountRef ?? raw.AdjustAccountRef)
  if (customer && ['invoices','customer-payments','sales-receipts','qb-credit-memos'].includes(moduleKey)) refs.push({ entityTypes:['Customer'], localTables:['customers'], sourceId:customer, label:`customer ${customer}` })
  if (vendor && ['bills','vendor-payments','vendor-credits','purchase-orders','qb-bill-payments','qb-time-activities'].includes(moduleKey)) refs.push({ entityTypes:['Vendor'], localTables:['vendors'], sourceId:vendor, label:`vendor ${vendor}` })
  if (deposit) refs.push({ entityTypes:['Account'], localTables:['chart_of_accounts'], sourceId:deposit, label:`deposit account ${deposit}` })
  if (ap) refs.push({ entityTypes:['Account'], localTables:['chart_of_accounts'], sourceId:ap, label:`A/P account ${ap}` })
  if (adjustment) refs.push({ entityTypes:['Account'], localTables:['chart_of_accounts'], sourceId:adjustment, label:`adjustment account ${adjustment}` })
  collectLineReferences(raw.Line, refs)
  const linkedTransactions=[...(Array.isArray(raw.LinkedTxn)?raw.LinkedTxn:[]),...(Array.isArray(raw.Line)?raw.Line.flatMap(value=>{const line=object(value);return Array.isArray(line.LinkedTxn)?line.LinkedTxn:[]}):[])]
  if (linkedTransactions.length && ['customer-payments','vendor-payments','qb-credit-memos','qb-deposits'].includes(moduleKey)) {
    for (const value of linkedTransactions) {
      const link = object(value); const id = String(link.TxnId ?? '').trim(); const type = String(link.TxnType ?? '').trim()
      const mapping: Record<string, [string[], string[]]> = {
        Invoice:[['Invoice'],['invoices']], Bill:[['Bill'],['bills']], Payment:[['Payment'],['payments']], VendorCredit:[['VendorCredit'],['vendor_credits']], CreditMemo:[['CreditMemo'],['invoices']],
      }
      if (id && mapping[type]) refs.push({ entityTypes:mapping[type][0], localTables:mapping[type][1], sourceId:id, label:`${type} ${id}` })
    }
  }
  return [...new Map(refs.map((ref) => [`${ref.entityTypes.join(',')}:${ref.sourceId}`, ref])).values()]
}

export async function assertQuickBooksDependencies(moduleKey: string, row: Row, ctx: ImportContext): Promise<void> {
  const realmId = typeof row._realmId === 'string' ? row._realmId : ''
  if (!realmId) return
  const raw = parseQuickBooksRaw(row)
  for (const reference of referencesFor(moduleKey, raw)) {
    const resolved = reference.entityTypes.length===1&&reference.entityTypes[0]==='Customer'
      ? await resolveQuickBooksCustomerContext(ctx.companyId,realmId,reference.sourceId)
      : await resolveQuickBooksLocalId(ctx.companyId, realmId, reference.sourceId, reference.entityTypes, reference.localTables)
    if (!resolved) throw new MissingDependencyError(reference.label, `${reference.label} must be migrated successfully before ${moduleKey}.`)
  }
}
