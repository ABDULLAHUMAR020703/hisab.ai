import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import { extractQuickBooksWebhookEvents, verifyQuickBooksWebhookSignature } from '../../src/lib/import-export/quickbooks/webhook-security'

const repositoryFile = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

test('QuickBooks webhook verification uses the exact raw body and verifier', () => {
  const body = JSON.stringify({ eventNotifications:[] })
  const verifier = 'webhook-secret'
  const signature = createHmac('sha256',verifier).update(body,'utf8').digest('base64')
  assert.equal(verifyQuickBooksWebhookSignature(body,signature,verifier),true)
  assert.equal(verifyQuickBooksWebhookSignature(`${body} `,signature,verifier),false)
  assert.equal(verifyQuickBooksWebhookSignature(body,null,verifier),false)
})

test('QuickBooks webhook events preserve deletions and form deterministic dedupe keys', () => {
  const payload = { eventNotifications:[{ realmId:'42', dataChangeEvent:{ entities:[{ name:'Invoice', id:'99', operation:'Delete', lastUpdated:'2026-07-31T00:00:00Z' }] } }] }
  const events = extractQuickBooksWebhookEvents(payload)
  assert.equal(events.length,1)
  assert.equal(events[0].event_id,'42:Invoice:99:Delete:2026-07-31T00:00:00Z')
  assert.equal(events[0].operation,'Delete')
})

test('source-document posting is atomic and idempotent at the database boundary', () => {
  const migration = repositoryFile('supabase/migrations/052_quickbooks_accounting_materialization.sql')
  const postingService = repositoryFile('src/lib/accounting/posting-service.ts')

  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.post_source_document_lines/)
  assert.match(migration, /IF EXISTS \(SELECT 1 FROM public\.ledger_entries/)
  assert.match(migration, /INSERT INTO public\.ledger_entries/)
  assert.match(migration, /UPDATE public\.chart_of_accounts/)
  assert.match(postingService, /\.rpc\('post_source_document_lines'/)
  assert.doesNotMatch(postingService, /\.from\('ledger_entries'\)\s*\.insert/)
})

test('transaction imports invoke native accounting materialization and protect posted history', () => {
  const transactionModule = repositoryFile('src/lib/import-export/registry/modules/transactions.module.ts')
  const materializer = repositoryFile('src/lib/import-export/quickbooks/accounting-materializer.ts')

  for (const moduleKey of ['invoices', 'bills', 'expenses', 'customer-payments', 'vendor-payments', 'journal-entries', 'sales-receipts', 'vendor-credits']) {
    assert.match(materializer, new RegExp(`['\"]?${moduleKey.replace('-', '\\-')}['\"]?\\s*:`))
  }
  assert.match(transactionModule, /materializeQuickBooksAccounting\(/)
  assert.match(transactionModule, /hasPostedLedger\(/)
  assert.match(transactionModule, /markQuickBooksMaterializationConflict\(/)
  assert.match(transactionModule, /Resolve the conflict instead of rewriting ledger history/)
  assert.match(materializer, /status:'manual_required'/)
  assert.match(materializer, /'sales-receipts':\{[^\n]*post:postSalesReceiptToLedger/)
  assert.doesNotMatch(materializer, /sales receipts do not retain posting lines/i)
})

test('migration validation includes accounting materialization integrity', () => {
  const validationService = repositoryFile('src/lib/quickbooks-validation/service.ts')
  const accountingValidation = repositoryFile('src/lib/quickbooks-validation/accounting.ts')

  assert.match(validationService, /validateQuickBooksAccountingMaterialization/)
  assert.match(validationService, /accounting\.passed/)
  assert.match(accountingValidation, /Ledger is not balanced/)
  assert.match(accountingValidation, /Payment is not linked to an invoice or bill/)
  assert.match(accountingValidation, /Tax-bearing source document has no tax ledger line/)
})

test('migration reports do not count unposted accounting documents as valid', () => {
  const migrationReport = repositoryFile('src/lib/import-export/quickbooks/migration-report-service.ts')

  assert.match(migrationReport, /quickbooks_materialization_runs/)
  assert.match(migrationReport, /run\.status !== 'completed'/)
  assert.match(migrationReport, /validCount:accountingValid\.length/)
})
