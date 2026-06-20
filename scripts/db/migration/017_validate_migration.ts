#!/usr/bin/env npx tsx
/**
 * Phase C — Step 4: Validate SQLite export vs Supabase after migration.
 * Usage: npx tsx scripts/db/migration/017_validate_migration.ts [--db path/to/dev.db]
 */
import fs from 'node:fs'
import Database from 'better-sqlite3'
import { COMPANY_ID, DEFAULT_SQLITE_PATH, EXPORT_TABLES } from './lib/constants'
import { loadExportManifest, loadExportTable } from './lib/id-map-store'
import { withPgClient } from './lib/pg-client'
import type { SqliteRow } from './lib/types'

interface CheckResult {
  name: string
  passed: boolean
  detail: string
}

const checks: CheckResult[] = []

function pass(name: string, detail: string) {
  checks.push({ name, passed: true, detail })
}

function fail(name: string, detail: string) {
  checks.push({ name, passed: false, detail })
}

const TABLE_MAP: Record<string, { sqlite: string; pg: string; filter?: string }> = {
  ChartOfAccount: { sqlite: 'ChartOfAccount', pg: 'chart_of_accounts', filter: 'legacy_id IS NOT NULL' },
  CostCenter: { sqlite: 'CostCenter', pg: 'cost_centers', filter: 'legacy_id IS NOT NULL' },
  TaxRate: { sqlite: 'TaxRate', pg: 'tax_rates', filter: 'legacy_id IS NOT NULL' },
  Sequence: { sqlite: 'Sequence', pg: 'sequences', filter: 'legacy_id IS NOT NULL' },
  Customer: { sqlite: 'Customer', pg: 'customers', filter: 'legacy_id IS NOT NULL' },
  Vendor: { sqlite: 'Vendor', pg: 'vendors', filter: 'legacy_id IS NOT NULL' },
  Employee: { sqlite: 'Employee', pg: 'employees', filter: 'legacy_id IS NOT NULL' },
  InventoryItem: { sqlite: 'InventoryItem', pg: 'inventory_items', filter: 'legacy_id IS NOT NULL' },
  JournalEntry: { sqlite: 'JournalEntry', pg: 'journal_entries', filter: 'legacy_id IS NOT NULL' },
  JournalLine: { sqlite: 'JournalLine', pg: 'journal_lines', filter: 'legacy_id IS NOT NULL' },
  Receipt: { sqlite: 'Receipt', pg: 'receipts', filter: 'legacy_id IS NOT NULL' },
  Expense: { sqlite: 'Expense', pg: 'expenses', filter: 'legacy_id IS NOT NULL' },
  ExpenseLine: { sqlite: 'ExpenseLine', pg: 'expense_lines', filter: 'legacy_id IS NOT NULL' },
  Bill: { sqlite: 'Bill', pg: 'bills', filter: 'legacy_id IS NOT NULL' },
  BillLine: { sqlite: 'BillLine', pg: 'bill_lines', filter: 'legacy_id IS NOT NULL' },
  Invoice: { sqlite: 'Invoice', pg: 'invoices', filter: 'legacy_id IS NOT NULL' },
  InvoiceLine: { sqlite: 'InvoiceLine', pg: 'invoice_lines', filter: 'legacy_id IS NOT NULL' },
  Payment: { sqlite: 'Payment', pg: 'payments', filter: 'legacy_id IS NOT NULL' },
  PayrollEntry: { sqlite: 'PayrollEntry', pg: 'payroll_entries', filter: 'legacy_id IS NOT NULL' },
  PayrollLine: { sqlite: 'PayrollLine', pg: 'payroll_lines', filter: 'legacy_id IS NOT NULL' },
  ZatcaCredential: { sqlite: 'ZatcaCredential', pg: 'zatca_credentials', filter: `company_id = '${COMPANY_ID}'` },
  ZatcaOnboardingRequest: { sqlite: 'ZatcaOnboardingRequest', pg: 'zatca_onboarding_requests', filter: `company_id = '${COMPANY_ID}'` },
  ZatcaAuditLog: { sqlite: 'ZatcaAuditLog', pg: 'zatca_audit_logs', filter: 'legacy_id IS NOT NULL' },
  ZatcaSandboxTestRun: { sqlite: 'ZatcaSandboxTestRun', pg: 'zatca_sandbox_test_runs', filter: 'legacy_id IS NOT NULL' },
  User: { sqlite: 'User', pg: 'profiles', filter: 'legacy_user_id IS NOT NULL' },
}

async function validateRowCounts(client: import('pg').Client, manifest: ReturnType<typeof loadExportManifest>) {
  for (const [label, cfg] of Object.entries(TABLE_MAP)) {
    const sqliteCount = manifest.tables[cfg.sqlite]?.rowCount ?? 0
    const where = cfg.filter ? `WHERE ${cfg.filter}` : ''
    const { rows } = await client.query(`SELECT count(*)::int AS c FROM public.${cfg.pg} ${where}`)
    const pgCount = rows[0]?.c ?? 0

    if (sqliteCount === pgCount) {
      pass(`Row count: ${label}`, `${sqliteCount} = ${pgCount}`)
    } else {
      fail(`Row count: ${label}`, `SQLite ${sqliteCount} ≠ Supabase ${pgCount}`)
    }
  }
}

async function validateIdMap(client: import('pg').Client, manifest: ReturnType<typeof loadExportManifest>) {
  let expected = 0
  for (const table of EXPORT_TABLES) {
    expected += manifest.tables[table]?.rowCount ?? 0
  }

  const { rows } = await client.query(`SELECT count(*)::int AS c FROM public.migration_id_map`)
  const actual = rows[0]?.c ?? 0

  if (actual >= expected) {
    pass('migration_id_map completeness', `${actual} entries (expected ≥ ${expected})`)
  } else {
    fail('migration_id_map completeness', `${actual} entries, expected ≥ ${expected}`)
  }
}

async function validateZatcaInvoices(client: import('pg').Client) {
  const sqliteInvoices = loadExportTable('Invoice')
  let invoiceErrors = 0

  for (const inv of sqliteInvoices) {
    const legacyId = String(inv.id)
    const { rows } = await client.query(
      `SELECT invoice_uuid, invoice_hash, previous_invoice_hash, created_at
       FROM public.invoices WHERE legacy_id = $1`,
      [legacyId],
    )
    if (rows.length === 0) {
      fail(`Invoice legacy_id ${legacyId}`, 'not found in Supabase')
      invoiceErrors++
      continue
    }
    const pg = rows[0]!

    const fields = [
      ['invoice_uuid', inv.invoiceUUID, pg.invoice_uuid],
      ['invoice_hash', inv.invoiceHash, pg.invoice_hash],
      ['previous_invoice_hash', inv.previousInvoiceHash, pg.previous_invoice_hash],
    ] as const

    for (const [label, sqliteVal, pgVal] of fields) {
      const s = sqliteVal == null ? null : String(sqliteVal)
      const p = pgVal == null ? null : String(pgVal)
      if (s !== p) {
        fail(`Invoice ${legacyId} ${label}`, `SQLite "${s}" ≠ PG "${p}"`)
        invoiceErrors++
      }
    }

    const sqliteCreated = new Date(String(inv.createdAt)).toISOString()
    const pgCreated = new Date(pg.created_at).toISOString()
    if (sqliteCreated !== pgCreated) {
      fail(`Invoice ${legacyId} created_at`, `${sqliteCreated} ≠ ${pgCreated}`)
      invoiceErrors++
    }
  }

  if (invoiceErrors === 0) {
    pass('ZATCA invoice field parity', `checked ${sqliteInvoices.length} invoices`)
  }
}

async function validateZatcaCredentials(client: import('pg').Client, dbPath: string) {
  const db = new Database(dbPath, { readonly: true })
  const sqliteRows = db.prepare('SELECT * FROM ZatcaCredential').all() as SqliteRow[]
  db.close()

  for (const cred of sqliteRows) {
    const env = String(cred.environment)
    const { rows } = await client.query(
      `SELECT compliance_csid, production_csid,
              length(csr_enc) AS csr_len,
              length(private_key_enc) AS key_len,
              length(certificate_enc) AS cert_len,
              length(secret_enc) AS secret_len
       FROM public.zatca_credentials
       WHERE company_id = $1 AND environment = $2::public.zatca_environment`,
      [COMPANY_ID, env],
    )

    if (rows.length === 0) {
      fail(`ZatcaCredential ${env}`, 'not found')
      continue
    }
    const pg = rows[0]!

    if (String(cred.complianceCsid ?? '') !== String(pg.compliance_csid ?? '')) {
      fail(`ZatcaCredential ${env} compliance_csid`, 'mismatch')
    }
    if (String(cred.productionCsid ?? '') !== String(pg.production_csid ?? '')) {
      fail(`ZatcaCredential ${env} production_csid`, 'mismatch')
    }

    const encFields = [
      ['csr_enc', cred.csrEnc, pg.csr_len],
      ['private_key_enc', cred.privateKeyEnc, pg.key_len],
      ['certificate_enc', cred.certificateEnc, pg.cert_len],
      ['secret_enc', cred.secretEnc, pg.secret_len],
    ] as const

    for (const [label, sqliteVal, pgLen] of encFields) {
      if (sqliteVal == null) continue
      const expectedLen = String(sqliteVal).length
      if (Number(pgLen) !== expectedLen) {
        fail(`ZatcaCredential ${env} ${label} length`, `SQLite ${expectedLen} ≠ PG ${pgLen}`)
      }
    }
  }

  pass('ZATCA credential parity', `checked ${sqliteRows.length} environments`)
}

async function validateSequences(client: import('pg').Client) {
  const sqliteSeq = loadExportTable('Sequence')
  for (const seq of sqliteSeq) {
    const { rows } = await client.query(
      `SELECT prefix, next_no FROM public.sequences
       WHERE company_id = $1 AND type = $2`,
      [COMPANY_ID, seq.type],
    )
    if (rows.length === 0) {
      fail(`Sequence ${seq.type}`, 'missing')
      continue
    }
    const pg = rows[0]!
    if (String(seq.prefix) !== String(pg.prefix) || Number(seq.nextNo) !== Number(pg.next_no)) {
      fail(`Sequence ${seq.type}`, `SQLite (${seq.prefix}, ${seq.nextNo}) ≠ PG (${pg.prefix}, ${pg.next_no})`)
    }
  }
  pass('Sequence counters', `checked ${sqliteSeq.length} types`)
}

async function main() {
  const idx = process.argv.indexOf('--db')
  const dbPath = idx >= 0 ? process.argv[idx + 1]! : DEFAULT_SQLITE_PATH

  if (!fs.existsSync(dbPath)) {
    console.error(`SQLite not found: ${dbPath}`)
    process.exit(1)
  }

  const manifest = loadExportManifest()

  await withPgClient(async (client) => {
    await validateRowCounts(client, manifest)
    await validateIdMap(client, manifest)
    await validateZatcaInvoices(client)
    await validateZatcaCredentials(client, dbPath)
    await validateSequences(client)
  })

  console.log('\n=== Migration Validation Report ===\n')
  let failed = 0
  for (const c of checks) {
    const icon = c.passed ? 'PASS' : 'FAIL'
    console.log(`[${icon}] ${c.name}`)
    if (!c.passed || process.argv.includes('--verbose')) {
      console.log(`       ${c.detail}`)
    }
    if (!c.passed) failed++
  }

  console.log(`\n${checks.length - failed}/${checks.length} checks passed`)
  if (failed > 0) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
