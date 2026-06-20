import type pg from 'pg'
import { createClient } from '@supabase/supabase-js'
import { COMPANY_ID, USER_ROLE_MAP } from './constants'
import { loadProjectEnv } from './load-env'
import type { IdMapStore } from './id-map-store'
import { loadExportTable } from './id-map-store'
import {
  parseJsonField,
  toBool,
  toInt,
  toJsonb,
  toNumeric,
  toTimestamptz,
  verbatim,
} from './transforms'
import type { SqliteRow } from './types'

export interface ImportStats {
  table: string
  inserted: number
}

export interface ImportResult {
  stats: ImportStats[]
  idMapRows: number
}

async function upsertRow(
  client: pg.Client,
  sql: string,
  values: unknown[],
): Promise<void> {
  await client.query(sql, values)
}

export async function importCompany(client: pg.Client, rows: SqliteRow[]): Promise<number> {
  if (rows.length === 0) return 0
  const s = rows[0]!

  await client.query(
    `UPDATE public.companies SET
       company_name = $2,
       legal_name = $3,
       tax_id = $4,
       commercial_registration = $5,
       address = $6,
       street_address = $7,
       building_number = $8,
       district = $9,
       city = $10,
       postal_code = $11,
       country = $12,
       phone = $13,
       email = $14,
       currency = $15,
       fiscal_year_start = $16,
       created_at = $17,
       updated_at = $18
     WHERE id = $1`,
    [
      COMPANY_ID,
      s.companyName,
      s.legalName,
      s.taxId,
      s.commercialRegistration,
      s.address,
      s.streetAddress,
      s.buildingNumber,
      s.district,
      s.city,
      s.postalCode,
      s.country ?? 'Saudi Arabia',
      s.phone,
      s.email,
      s.currency ?? 'SAR',
      s.fiscalYearStart ?? '01-01',
      toTimestamptz(s.createdAt),
      toTimestamptz(s.updatedAt),
    ],
  )

  await client.query(
    `UPDATE public.company_zatca_settings SET
       zatca_enabled = $2,
       zatca_connected = $3,
       zatca_connected_at = $4,
       zatca_environment = $5,
       zatca_egs_unit_id = $6,
       zatca_device_identifier = $7,
       zatca_egs_serial_number = $8,
       zatca_business_category = $9,
       updated_at = $10
     WHERE company_id = $1`,
    [
      COMPANY_ID,
      toBool(s.zatcaEnabled),
      toBool(s.zatcaConnected),
      toTimestamptz(s.zatcaConnectedAt),
      s.zatcaEnvironment ?? 'SANDBOX',
      s.zatcaEgsUnitId,
      s.zatcaDeviceIdentifier,
      s.zatcaEgsSerialNumber,
      s.zatcaBusinessCategory,
      toTimestamptz(s.updatedAt),
    ],
  )

  return 1
}

export async function importAuthUsers(
  client: pg.Client,
  map: IdMapStore,
  rows: SqliteRow[],
): Promise<number> {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceKey) {
    console.warn('  SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — skipping auth.users creation')
    console.warn('  Profiles will only be updated if matching auth.users exist by email')
  }

  const admin = supabaseUrl && serviceKey
    ? createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
    : null

  const defaultPassword = process.env.MIGRATION_USER_PASSWORD ?? 'HisabMigration2026!'
  let count = 0

  for (const u of rows) {
    const userId = map.require('User', String(u.id))
    const email = String(u.email)
    const role = USER_ROLE_MAP[String(u.role)] ?? 'ACCOUNTANT'

    if (admin) {
      const { data: listData } = await admin.auth.admin.listUsers()
      const found = listData?.users?.find((x) => x.email === email)

      if (found) {
        if (found.id !== userId) {
          console.warn(`  User ${email} exists with different UUID (${found.id}); using existing auth id`)
          map.setSupabaseId('User', String(u.id), found.id)
        }
      } else {
        const { error } = await admin.auth.admin.createUser({
          id: userId,
          email,
          password: defaultPassword,
          email_confirm: true,
          user_metadata: { full_name: u.name ?? email.split('@')[0] },
        })
        if (error && !error.message.includes('already been registered')) {
          throw new Error(`Auth user create failed for ${email}: ${error.message}`)
        }
      }
    }

    const profileId = map.resolve('User', String(u.id)) ?? userId

    await client.query(
      `INSERT INTO public.profiles (id, full_name, legacy_user_id, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET
         full_name = EXCLUDED.full_name,
         legacy_user_id = EXCLUDED.legacy_user_id,
         is_active = EXCLUDED.is_active,
         updated_at = EXCLUDED.updated_at`,
      [
        profileId,
        u.name,
        String(u.id),
        toBool(u.isActive),
        toTimestamptz(u.createdAt),
        toTimestamptz(u.updatedAt),
      ],
    )

    await client.query(
      `INSERT INTO public.company_users (company_id, user_id, role, is_active, created_at, updated_at)
       VALUES ($1, $2, $3::public.company_role, $4, $5, $6)
       ON CONFLICT (company_id, user_id) DO UPDATE SET
         role = EXCLUDED.role,
         is_active = EXCLUDED.is_active,
         updated_at = EXCLUDED.updated_at`,
      [
        COMPANY_ID,
        profileId,
        role,
        toBool(u.isActive),
        toTimestamptz(u.createdAt),
        toTimestamptz(u.updatedAt),
      ],
    )

    count++
  }

  return count
}

async function importSimpleRows(
  client: pg.Client,
  table: string,
  rows: SqliteRow[],
  build: (row: SqliteRow) => { sql: string; values: unknown[] },
): Promise<number> {
  let n = 0
  for (const row of rows) {
    const { sql, values } = build(row)
    await upsertRow(client, sql, values)
    n++
  }
  return n
}

export async function runFullImport(client: pg.Client, map: IdMapStore): Promise<ImportResult> {
  const stats: ImportStats[] = []

  stats.push({ table: 'companies', inserted: await importCompany(client, loadExportTable('CompanySettings')) })
  stats.push({ table: 'auth.users+profiles', inserted: await importAuthUsers(client, map, loadExportTable('User')) })

  stats.push({
    table: 'chart_of_accounts',
    inserted: await importSimpleRows(client, 'chart_of_accounts', loadExportTable('ChartOfAccount'), (r) => ({
      sql: `INSERT INTO public.chart_of_accounts (
        id, company_id, legacy_id, account_no, full_name, name, parent_no, account_type, sub_type,
        is_active, description, balance, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      ON CONFLICT (id) DO UPDATE SET
        account_no=EXCLUDED.account_no, full_name=EXCLUDED.full_name, name=EXCLUDED.name,
        balance=EXCLUDED.balance, updated_at=EXCLUDED.updated_at`,
      values: [
        map.require('ChartOfAccount', String(r.id)),
        COMPANY_ID,
        String(r.id),
        r.accountNo,
        r.fullName,
        r.name,
        r.parentNo,
        r.accountType,
        r.subType,
        toBool(r.isActive),
        r.description,
        toNumeric(r.balance),
        toTimestamptz(r.createdAt),
        toTimestamptz(r.updatedAt),
      ],
    })),
  })

  stats.push({
    table: 'cost_centers',
    inserted: await importSimpleRows(client, 'cost_centers', loadExportTable('CostCenter'), (r) => ({
      sql: `INSERT INTO public.cost_centers (
        id, company_id, legacy_id, code, name, type, description, is_active, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (id) DO UPDATE SET code=EXCLUDED.code, name=EXCLUDED.name, updated_at=EXCLUDED.updated_at`,
      values: [
        map.require('CostCenter', String(r.id)),
        COMPANY_ID,
        String(r.id),
        r.code,
        r.name,
        r.type ?? 'PROJECT',
        r.description,
        toBool(r.isActive),
        toTimestamptz(r.createdAt),
        toTimestamptz(r.updatedAt),
      ],
    })),
  })

  stats.push({
    table: 'tax_rates',
    inserted: await importSimpleRows(client, 'tax_rates', loadExportTable('TaxRate'), (r) => ({
      sql: `INSERT INTO public.tax_rates (
        id, company_id, legacy_id, name, rate, type, is_default, is_active, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, rate=EXCLUDED.rate`,
      values: [
        map.require('TaxRate', String(r.id)),
        COMPANY_ID,
        String(r.id),
        r.name,
        toNumeric(r.rate),
        r.type ?? 'VAT',
        toBool(r.isDefault),
        toBool(r.isActive),
        toTimestamptz(r.createdAt),
      ],
    })),
  })

  stats.push({
    table: 'sequences',
    inserted: await importSimpleRows(client, 'sequences', loadExportTable('Sequence'), (r) => ({
      sql: `INSERT INTO public.sequences (id, company_id, legacy_id, type, prefix, next_no)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (company_id, type) DO UPDATE SET prefix=EXCLUDED.prefix, next_no=EXCLUDED.next_no, legacy_id=EXCLUDED.legacy_id`,
      values: [
        map.require('Sequence', String(r.id)),
        COMPANY_ID,
        String(r.id),
        r.type,
        r.prefix,
        toInt(r.nextNo),
      ],
    })),
  })

  stats.push({
    table: 'customers',
    inserted: await importSimpleRows(client, 'customers', loadExportTable('Customer'), (r) => ({
      sql: `INSERT INTO public.customers (
        id, company_id, legacy_id, customer_no, name, email, phone, address, street_address,
        building_number, district, city, country, postal_code, tax_id, credit_limit, payment_terms,
        is_active, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
      ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, tax_id=EXCLUDED.tax_id, updated_at=EXCLUDED.updated_at`,
      values: [
        map.require('Customer', String(r.id)),
        COMPANY_ID,
        String(r.id),
        r.customerNo,
        r.name,
        r.email,
        r.phone,
        r.address,
        r.streetAddress,
        r.buildingNumber,
        r.district,
        r.city,
        r.country,
        r.postalCode,
        r.taxId,
        toNumeric(r.creditLimit),
        toInt(r.paymentTerms),
        toBool(r.isActive),
        toTimestamptz(r.createdAt),
        toTimestamptz(r.updatedAt),
      ],
    })),
  })

  stats.push({
    table: 'vendors',
    inserted: await importSimpleRows(client, 'vendors', loadExportTable('Vendor'), (r) => ({
      sql: `INSERT INTO public.vendors (
        id, company_id, legacy_id, vendor_no, name, email, phone, address, city, country,
        tax_id, payment_terms, is_active, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, updated_at=EXCLUDED.updated_at`,
      values: [
        map.require('Vendor', String(r.id)),
        COMPANY_ID,
        String(r.id),
        r.vendorNo,
        r.name,
        r.email,
        r.phone,
        r.address,
        r.city,
        r.country,
        r.taxId,
        toInt(r.paymentTerms),
        toBool(r.isActive),
        toTimestamptz(r.createdAt),
        toTimestamptz(r.updatedAt),
      ],
    })),
  })

  stats.push({
    table: 'employees',
    inserted: await importSimpleRows(client, 'employees', loadExportTable('Employee'), (r) => ({
      sql: `INSERT INTO public.employees (
        id, company_id, legacy_id, employee_no, name, email, phone, department, position,
        joining_date, salary, salary_type, bank_account, is_active, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, updated_at=EXCLUDED.updated_at`,
      values: [
        map.require('Employee', String(r.id)),
        COMPANY_ID,
        String(r.id),
        r.employeeNo,
        r.name,
        r.email,
        r.phone,
        r.department,
        r.position,
        toTimestamptz(r.joiningDate),
        toNumeric(r.salary),
        r.salaryType ?? 'MONTHLY',
        r.bankAccount,
        toBool(r.isActive),
        toTimestamptz(r.createdAt),
        toTimestamptz(r.updatedAt),
      ],
    })),
  })

  stats.push({
    table: 'inventory_items',
    inserted: await importSimpleRows(client, 'inventory_items', loadExportTable('InventoryItem'), (r) => ({
      sql: `INSERT INTO public.inventory_items (
        id, company_id, legacy_id, item_code, name, description, category, unit,
        cost_price, sale_price, quantity, min_quantity, is_active, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, quantity=EXCLUDED.quantity, updated_at=EXCLUDED.updated_at`,
      values: [
        map.require('InventoryItem', String(r.id)),
        COMPANY_ID,
        String(r.id),
        r.itemCode,
        r.name,
        r.description,
        r.category,
        r.unit ?? 'PCS',
        toNumeric(r.costPrice),
        toNumeric(r.salePrice),
        toNumeric(r.quantity),
        toNumeric(r.minQuantity),
        toBool(r.isActive),
        toTimestamptz(r.createdAt),
        toTimestamptz(r.updatedAt),
      ],
    })),
  })

  stats.push({
    table: 'receipts',
    inserted: await importSimpleRows(client, 'receipts', loadExportTable('Receipt'), (r) => ({
      sql: `INSERT INTO public.receipts (
        id, company_id, legacy_id, file_name, file_path, mime_type, vendor, amount, date,
        description, status, uploaded_by_id, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      ON CONFLICT (id) DO UPDATE SET file_name=EXCLUDED.file_name`,
      values: [
        map.require('Receipt', String(r.id)),
        COMPANY_ID,
        String(r.id),
        r.fileName,
        r.filePath,
        r.mimeType,
        r.vendor,
        r.amount != null ? toNumeric(r.amount) : null,
        toTimestamptz(r.date),
        r.description,
        r.status ?? 'UNPROCESSED',
        map.resolve('User', r.uploadedById as string),
        toTimestamptz(r.createdAt),
      ],
    })),
  })

  stats.push({
    table: 'journal_entries',
    inserted: await importSimpleRows(client, 'journal_entries', loadExportTable('JournalEntry'), (r) => ({
      sql: `INSERT INTO public.journal_entries (
        id, company_id, legacy_id, entry_no, date, description, reference, status,
        total_debit, total_credit, created_by_id, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status, updated_at=EXCLUDED.updated_at`,
      values: [
        map.require('JournalEntry', String(r.id)),
        COMPANY_ID,
        String(r.id),
        r.entryNo,
        toTimestamptz(r.date),
        r.description,
        r.reference,
        r.status ?? 'DRAFT',
        toNumeric(r.totalDebit),
        toNumeric(r.totalCredit),
        map.resolve('User', r.createdById as string),
        toTimestamptz(r.createdAt),
        toTimestamptz(r.updatedAt),
      ],
    })),
  })

  stats.push({
    table: 'journal_lines',
    inserted: await importSimpleRows(client, 'journal_lines', loadExportTable('JournalLine'), (r) => ({
      sql: `INSERT INTO public.journal_lines (
        id, company_id, legacy_id, journal_id, account_id, cost_center_id, description, debit, credit, tax_rate
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (id) DO UPDATE SET debit=EXCLUDED.debit, credit=EXCLUDED.credit`,
      values: [
        map.require('JournalLine', String(r.id)),
        COMPANY_ID,
        String(r.id),
        map.require('JournalEntry', r.journalId as string),
        map.require('ChartOfAccount', r.accountId as string),
        map.resolve('CostCenter', r.costCenterId as string),
        r.description,
        toNumeric(r.debit),
        toNumeric(r.credit),
        toNumeric(r.taxRate),
      ],
    })),
  })

  stats.push({
    table: 'expenses',
    inserted: await importSimpleRows(client, 'expenses', loadExportTable('Expense'), (r) => ({
      sql: `INSERT INTO public.expenses (
        id, company_id, legacy_id, expense_no, date, description, category, status,
        total, tax_amount, receipt_id, created_by_id, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status, updated_at=EXCLUDED.updated_at`,
      values: [
        map.require('Expense', String(r.id)),
        COMPANY_ID,
        String(r.id),
        r.expenseNo,
        toTimestamptz(r.date),
        r.description,
        r.category,
        r.status ?? 'PENDING',
        toNumeric(r.total),
        toNumeric(r.taxAmount),
        map.resolve('Receipt', r.receiptId as string),
        map.resolve('User', r.createdById as string),
        toTimestamptz(r.createdAt),
        toTimestamptz(r.updatedAt),
      ],
    })),
  })

  stats.push({
    table: 'expense_lines',
    inserted: await importSimpleRows(client, 'expense_lines', loadExportTable('ExpenseLine'), (r) => ({
      sql: `INSERT INTO public.expense_lines (
        id, company_id, legacy_id, expense_id, account_id, description, amount, tax_rate
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (id) DO UPDATE SET amount=EXCLUDED.amount`,
      values: [
        map.require('ExpenseLine', String(r.id)),
        COMPANY_ID,
        String(r.id),
        map.require('Expense', r.expenseId as string),
        map.resolve('ChartOfAccount', r.accountId as string),
        r.description,
        toNumeric(r.amount),
        toNumeric(r.taxRate),
      ],
    })),
  })

  stats.push({
    table: 'bills',
    inserted: await importSimpleRows(client, 'bills', loadExportTable('Bill'), (r) => ({
      sql: `INSERT INTO public.bills (
        id, company_id, legacy_id, bill_no, vendor_id, date, due_date, status,
        subtotal, tax_amount, total, amount_paid, balance, notes, reference,
        created_by_id, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status, updated_at=EXCLUDED.updated_at`,
      values: [
        map.require('Bill', String(r.id)),
        COMPANY_ID,
        String(r.id),
        r.billNo,
        map.require('Vendor', r.vendorId as string),
        toTimestamptz(r.date),
        toTimestamptz(r.dueDate),
        r.status ?? 'DRAFT',
        toNumeric(r.subtotal),
        toNumeric(r.taxAmount),
        toNumeric(r.total),
        toNumeric(r.amountPaid),
        toNumeric(r.balance),
        r.notes,
        r.reference,
        map.resolve('User', r.createdById as string),
        toTimestamptz(r.createdAt),
        toTimestamptz(r.updatedAt),
      ],
    })),
  })

  stats.push({
    table: 'bill_lines',
    inserted: await importSimpleRows(client, 'bill_lines', loadExportTable('BillLine'), (r) => ({
      sql: `INSERT INTO public.bill_lines (
        id, company_id, legacy_id, bill_id, account_id, cost_center_id, description,
        quantity, unit_price, tax_rate, amount
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT (id) DO UPDATE SET amount=EXCLUDED.amount`,
      values: [
        map.require('BillLine', String(r.id)),
        COMPANY_ID,
        String(r.id),
        map.require('Bill', r.billId as string),
        map.resolve('ChartOfAccount', r.accountId as string),
        map.resolve('CostCenter', r.costCenterId as string),
        r.description,
        toNumeric(r.quantity),
        toNumeric(r.unitPrice),
        toNumeric(r.taxRate),
        toNumeric(r.amount),
      ],
    })),
  })

  stats.push({
    table: 'invoices',
    inserted: await importSimpleRows(client, 'invoices', loadExportTable('Invoice'), (r) => ({
      sql: `INSERT INTO public.invoices (
        id, company_id, legacy_id, invoice_no, invoice_uuid, invoice_hash, previous_invoice_hash,
        invoice_type, customer_id, date, issue_time, due_date, currency, status,
        subtotal, tax_amount, total, amount_paid, balance,
        zatca_status, clearance_status, zatca_response_code, zatca_response_message,
        zatca_failure_code, zatca_request_id, zatca_response_payload, cleared_invoice_payload,
        signed_xml, zatca_submission_date, notes, terms, is_recurring, recurring_day, next_due_date,
        created_by_id, created_at, updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8::public.invoice_type,$9,$10,$11,$12,$13,$14,
        $15,$16,$17,$18,$19,
        $20::public.zatca_invoice_status,$21,$22,$23,
        $24,$25,$26,$27,
        $28,$29,$30,$31,$32,$33,$34,
        $35,$36,$37
      )
      ON CONFLICT (id) DO UPDATE SET
        invoice_uuid=EXCLUDED.invoice_uuid,
        invoice_hash=EXCLUDED.invoice_hash,
        previous_invoice_hash=EXCLUDED.previous_invoice_hash,
        signed_xml=EXCLUDED.signed_xml,
        zatca_status=EXCLUDED.zatca_status,
        created_at=EXCLUDED.created_at,
        updated_at=EXCLUDED.updated_at`,
      values: [
        map.require('Invoice', String(r.id)),
        COMPANY_ID,
        String(r.id),
        r.invoiceNo,
        verbatim(r.invoiceUUID),
        verbatim(r.invoiceHash),
        verbatim(r.previousInvoiceHash),
        r.invoiceType ?? 'STANDARD',
        map.require('Customer', r.customerId as string),
        toTimestamptz(r.date),
        r.issueTime,
        toTimestamptz(r.dueDate),
        r.currency ?? 'SAR',
        r.status ?? 'DRAFT',
        toNumeric(r.subtotal),
        toNumeric(r.taxAmount),
        toNumeric(r.total),
        toNumeric(r.amountPaid),
        toNumeric(r.balance),
        r.zatcaStatus ?? 'DRAFT',
        r.clearanceStatus,
        r.zatcaResponseCode,
        r.zatcaResponseMessage,
        r.zatcaFailureCode,
        r.zatcaRequestId,
        toJsonb(r.zatcaResponsePayload, 'zatcaResponsePayload'),
        toJsonb(r.clearedInvoicePayload, 'clearedInvoicePayload', true),
        verbatim(r.signedXml),
        toTimestamptz(r.zatcaSubmissionDate),
        r.notes,
        r.terms,
        toBool(r.isRecurring),
        r.recurringDay != null ? toInt(r.recurringDay) : null,
        toTimestamptz(r.nextDueDate),
        map.resolve('User', r.createdById as string),
        toTimestamptz(r.createdAt),
        toTimestamptz(r.updatedAt),
      ],
    })),
  })

  stats.push({
    table: 'invoice_lines',
    inserted: await importSimpleRows(client, 'invoice_lines', loadExportTable('InvoiceLine'), (r) => ({
      sql: `INSERT INTO public.invoice_lines (
        id, company_id, legacy_id, invoice_id, account_id, cost_center_id, description,
        quantity, unit_price, tax_rate, amount
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT (id) DO UPDATE SET amount=EXCLUDED.amount`,
      values: [
        map.require('InvoiceLine', String(r.id)),
        COMPANY_ID,
        String(r.id),
        map.require('Invoice', r.invoiceId as string),
        map.resolve('ChartOfAccount', r.accountId as string),
        map.resolve('CostCenter', r.costCenterId as string),
        r.description,
        toNumeric(r.quantity),
        toNumeric(r.unitPrice),
        toNumeric(r.taxRate),
        toNumeric(r.amount),
      ],
    })),
  })

  stats.push({
    table: 'payments',
    inserted: await importSimpleRows(client, 'payments', loadExportTable('Payment'), (r) => ({
      sql: `INSERT INTO public.payments (
        id, company_id, legacy_id, payment_no, date, amount, method, reference, notes,
        invoice_id, bill_id, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT (id) DO UPDATE SET amount=EXCLUDED.amount`,
      values: [
        map.require('Payment', String(r.id)),
        COMPANY_ID,
        String(r.id),
        r.paymentNo,
        toTimestamptz(r.date),
        toNumeric(r.amount),
        r.method ?? 'BANK_TRANSFER',
        r.reference,
        r.notes,
        map.resolve('Invoice', r.invoiceId as string),
        map.resolve('Bill', r.billId as string),
        toTimestamptz(r.createdAt),
      ],
    })),
  })

  stats.push({
    table: 'payroll_entries',
    inserted: await importSimpleRows(client, 'payroll_entries', loadExportTable('PayrollEntry'), (r) => ({
      sql: `INSERT INTO public.payroll_entries (
        id, company_id, legacy_id, payroll_no, employee_id, period, period_start, period_end,
        basic_salary, allowances, deductions, tax_amount, net_salary, status, paid_at, notes,
        created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status, updated_at=EXCLUDED.updated_at`,
      values: [
        map.require('PayrollEntry', String(r.id)),
        COMPANY_ID,
        String(r.id),
        r.payrollNo,
        map.require('Employee', r.employeeId as string),
        r.period,
        toTimestamptz(r.periodStart),
        toTimestamptz(r.periodEnd),
        toNumeric(r.basicSalary),
        toNumeric(r.allowances),
        toNumeric(r.deductions),
        toNumeric(r.taxAmount),
        toNumeric(r.netSalary),
        r.status ?? 'DRAFT',
        toTimestamptz(r.paidAt),
        r.notes,
        toTimestamptz(r.createdAt),
        toTimestamptz(r.updatedAt),
      ],
    })),
  })

  stats.push({
    table: 'payroll_lines',
    inserted: await importSimpleRows(client, 'payroll_lines', loadExportTable('PayrollLine'), (r) => ({
      sql: `INSERT INTO public.payroll_lines (
        id, company_id, legacy_id, payroll_id, type, description, amount
      ) VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (id) DO UPDATE SET amount=EXCLUDED.amount`,
      values: [
        map.require('PayrollLine', String(r.id)),
        COMPANY_ID,
        String(r.id),
        map.require('PayrollEntry', r.payrollId as string),
        r.type,
        r.description,
        toNumeric(r.amount),
      ],
    })),
  })

  // ZATCA — encrypted fields copied verbatim
  stats.push({
    table: 'zatca_credentials',
    inserted: await importSimpleRows(client, 'zatca_credentials', loadExportTable('ZatcaCredential'), (r) => ({
      sql: `INSERT INTO public.zatca_credentials (
        id, company_id, environment, egs_unit_id, csr, csr_enc, private_key_enc,
        certificate, certificate_enc, secret_enc, binary_security_token_enc,
        compliance_csid, request_id, production_csid, production_certificate, production_certificate_enc,
        onboarding_status, last_error, onboarded_at, created_at, updated_at
      ) VALUES (
        $1,$2,$3::public.zatca_environment,$4,$5,$6,$7,
        $8,$9,$10,$11,
        $12,$13,$14,$15,$16,
        $17::public.zatca_onboarding_status,$18,$19,$20,$21
      )
      ON CONFLICT (company_id, environment) DO UPDATE SET
        csr_enc=EXCLUDED.csr_enc,
        private_key_enc=EXCLUDED.private_key_enc,
        certificate_enc=EXCLUDED.certificate_enc,
        secret_enc=EXCLUDED.secret_enc,
        binary_security_token_enc=EXCLUDED.binary_security_token_enc,
        compliance_csid=EXCLUDED.compliance_csid,
        production_csid=EXCLUDED.production_csid,
        production_certificate_enc=EXCLUDED.production_certificate_enc,
        onboarding_status=EXCLUDED.onboarding_status,
        updated_at=EXCLUDED.updated_at`,
      values: [
        map.require('ZatcaCredential', String(r.id)),
        COMPANY_ID,
        r.environment,
        r.egsUnitId,
        verbatim(r.csr),
        verbatim(r.csrEnc),
        verbatim(r.privateKeyEnc),
        verbatim(r.certificate),
        verbatim(r.certificateEnc),
        verbatim(r.secretEnc),
        verbatim(r.binarySecurityTokenEnc),
        verbatim(r.complianceCsid),
        r.requestId,
        verbatim(r.productionCsid),
        verbatim(r.productionCertificate),
        verbatim(r.productionCertificateEnc),
        r.onboardingStatus ?? 'NOT_STARTED',
        r.lastError,
        toTimestamptz(r.onboardedAt),
        toTimestamptz(r.createdAt),
        toTimestamptz(r.updatedAt),
      ],
    })),
  })

  stats.push({
    table: 'zatca_onboarding_requests',
    inserted: await importSimpleRows(client, 'zatca_onboarding_requests', loadExportTable('ZatcaOnboardingRequest'), (r) => ({
      sql: `INSERT INTO public.zatca_onboarding_requests (
        id, company_id, environment, egs_unit_id, request_id, status, error_message, created_at, updated_at
      ) VALUES ($1,$2,$3::public.zatca_environment,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status, request_id=EXCLUDED.request_id`,
      values: [
        map.require('ZatcaOnboardingRequest', String(r.id)),
        COMPANY_ID,
        r.environment,
        r.egsUnitId,
        r.requestId,
        r.status ?? 'PENDING',
        r.errorMessage,
        toTimestamptz(r.createdAt),
        toTimestamptz(r.updatedAt),
      ],
    })),
  })

  stats.push({
    table: 'zatca_audit_logs',
    inserted: await importSimpleRows(client, 'zatca_audit_logs', loadExportTable('ZatcaAuditLog'), (r) => ({
      sql: `INSERT INTO public.zatca_audit_logs (
        id, company_id, legacy_id, action, result, message, user_id, user_name, company_name,
        invoice_id, metadata, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT (id) DO UPDATE SET action=EXCLUDED.action, metadata=EXCLUDED.metadata`,
      values: [
        map.require('ZatcaAuditLog', String(r.id)),
        COMPANY_ID,
        String(r.id),
        r.action,
        r.result,
        r.message,
        map.resolve('User', r.userId as string),
        r.userName,
        r.companyName,
        map.resolve('Invoice', r.invoiceId as string),
        toJsonb(r.metadata, 'metadata'),
        toTimestamptz(r.createdAt),
      ],
    })),
  })

  stats.push({
    table: 'zatca_sandbox_test_runs',
    inserted: await importSimpleRows(client, 'zatca_sandbox_test_runs', loadExportTable('ZatcaSandboxTestRun'), (r) => ({
      sql: `INSERT INTO public.zatca_sandbox_test_runs (
        id, company_id, legacy_id, scenario, passed, steps, error, duration_ms, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (id) DO UPDATE SET passed=EXCLUDED.passed, steps=EXCLUDED.steps`,
      values: [
        map.require('ZatcaSandboxTestRun', String(r.id)),
        COMPANY_ID,
        String(r.id),
        r.scenario,
        toBool(r.passed),
        toJsonb(r.steps, 'steps'),
        r.error,
        r.durationMs != null ? toInt(r.durationMs) : null,
        toTimestamptz(r.createdAt),
      ],
    })),
  })

  const idMapRows = await map.persistToPostgres(client)

  return { stats, idMapRows }
}
