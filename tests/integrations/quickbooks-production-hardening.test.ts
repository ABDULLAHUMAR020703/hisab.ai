import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import { fiscalPeriodForDate,nextFiscalPeriod } from '../../src/lib/accounting/fiscal-calendar'
import { openingSubledgerDocumentType,openingSubledgerKey } from '../../src/lib/accounting/opening-subledger-engine'
import { QuickBooksIntegrationService } from '../../src/integrations/accounting/providers/quickbooks/quickbooks-integration.service'
import { QuickBooksImportAdapter } from '../../src/lib/import-export/sources/quickbooks.adapter'
import { Provider } from '../../src/integrations/accounting/contracts/types'
import type { AccountingProvider } from '../../src/integrations/accounting/contracts/accounting-provider'

const file=(path:string)=>readFileSync(resolve(process.cwd(),path),'utf8')

test('fiscal periods respect calendar and non-calendar company settings',()=>{
  const calendar=fiscalPeriodForDate(new Date('2026-08-01T00:00:00Z'),'01-01')
  assert.equal(calendar.start.toISOString(),'2026-01-01T00:00:00.000Z')
  assert.equal(calendar.end.toISOString(),'2026-12-31T23:59:59.999Z')
  const july=fiscalPeriodForDate(new Date('2026-03-01T00:00:00Z'),'07-01')
  assert.equal(july.start.toISOString(),'2025-07-01T00:00:00.000Z')
  assert.equal(july.end.toISOString(),'2026-06-30T23:59:59.999Z')
  const next=nextFiscalPeriod(july.end)
  assert.equal(next.start.toISOString(),'2026-07-01T00:00:00.000Z')
  assert.equal(next.end.toISOString(),'2027-06-30T23:59:59.999Z')
})

test('year close creates a non-posting carry-forward memorandum and remains repeat-safe',()=>{
  const source=file('src/lib/accounting/year-close.ts')
  assert.match(source,/nextFiscalPeriod\(periodEnd\)/)
  assert.doesNotMatch(source,/postJournalEntry\(openingJournalId/)
  assert.match(source,/Fiscal period is already closed/)
  assert.match(source,/fiscal_year_closings/)
})

test('opening AR and AP select native debit and credit subledger documents',()=>{
  assert.equal(openingSubledgerDocumentType('AR',100),'INVOICE')
  assert.equal(openingSubledgerDocumentType('AR',-100),'CUSTOMER_CREDIT')
  assert.equal(openingSubledgerDocumentType('AP',100),'BILL')
  assert.equal(openingSubledgerDocumentType('AP',-100),'VENDOR_CREDIT')
  assert.equal(openingSubledgerKey('run-1','AR','customer-1'),openingSubledgerKey('run-1','AR','customer-1'))
  const cutoff=file('src/lib/quickbooks-cutoff/service.ts')
  assert.match(cutoff,/materializeOpeningSubledgerBalances/)
  assert.doesNotMatch(cutoff,/aggregateRows\(\[\.\.\.hisab\.rows,\.\.\.additions\]/)
})

test('QuickBooks provider extracts TaxCode and TaxRate as distinct entities',async()=>{
  const queries:string[]=[]
  const service=new QuickBooksIntegrationService({clientId:'id',clientSecret:'secret',redirectUri:'https://test/callback',environment:'sandbox'},async input=>{
    const query=new URL(String(input)).searchParams.get('query')??'';queries.push(query)
    return query.includes('TaxCode')?Response.json({QueryResponse:{TaxCode:[{Id:'code-1'}]}}):Response.json({QueryResponse:{TaxRate:[{Id:'rate-1'}]}})
  })
  assert.equal((await service.getTaxCodes({accessToken:'x',realmId:'1'})).length,1)
  assert.equal((await service.getTaxRates({accessToken:'x',realmId:'1'})).length,1)
  assert.ok(queries.some(query=>query.includes('FROM TaxCode')))
  assert.ok(queries.some(query=>query.includes('FROM TaxRate')))
})

test('every high-volume transaction uses partitioned extraction and checkpoints',async()=>{
  const calls:Array<{entity:string;partitioned?:boolean;checkpoint?:boolean}>=[]
  const provider={slug:Provider.QUICKBOOKS,getEntityRecords:async(_context:unknown,entity:string,options?:{partitioned?:boolean;onCheckpoint?:unknown})=>{calls.push({entity,partitioned:options?.partitioned,checkpoint:Boolean(options?.onCheckpoint)});return[]}} as unknown as AccountingProvider
  const adapter=new QuickBooksImportAdapter(),context={accessToken:'x',realmId:'1'}
  for(const resource of ['invoices','bills','expenses','journal-entries','sales-receipts','purchase-orders','vendor-credits','customer-payments','vendor-payments'])await adapter.fetchResource(provider,context,resource,{onCheckpoint:async()=>{}})
  assert.equal(calls.length,9)
  assert.ok(calls.every(call=>call.partitioned&&call.checkpoint))
})

test('RLS, authorization, checkpoint retry, and declared test tooling are release hardened',()=>{
  const migration=file('supabase/migrations/061_quickbooks_production_hardening.sql')
  for(const table of ['accounting_sync_settings','accounting_sync_runs','accounting_sync_changes']){
    assert.match(migration,new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`))
    assert.match(migration,new RegExp(`CREATE POLICY ${table}`))
  }
  const sync=file('src/app/api/integrations/quickbooks/sync/route.ts')
  assert.match(sync,/requireAccountingAdmin/)
  const importer=file('src/app/api/import-export/[module]/import/route.ts')
  assert.match(importer,/requireAccountingAdmin/)
  const jobs=file('src/lib/import-export/jobs/import-job.service.ts')
  assert.doesNotMatch(jobs,/status: 'pending', batch_cursor: 0/)
  const sourceRegistry=file('src/lib/import-export/sources/source-registry.ts')
  assert.match(sourceRegistry,/\['running','failed'\]\.includes/)
  const pkg=JSON.parse(file('package.json')) as {devDependencies?:Record<string,string>}
  assert.ok(pkg.devDependencies?.tsx)
})
