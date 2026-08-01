import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const POSTGRES_BIN = process.env.POSTGRES_BIN ?? (process.platform === 'win32' ? 'C:\\Program Files\\PostgreSQL\\15\\bin' : '')

function executable(name: string) {
  const extension = process.platform === 'win32' ? '.exe' : ''
  const local = POSTGRES_BIN ? join(POSTGRES_BIN, `${name}${extension}`) : ''
  return local && existsSync(local) ? local : name
}

function run(command: string, args: string[], input?: string) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    input,
    env: { ...process.env, PGCONNECT_TIMEOUT: '5' },
    timeout: 30_000,
    windowsHide: true,
  })
  assert.equal(result.status, 0, `${command} ${args.join(' ')} failed:\n${result.stdout}\n${result.stderr}`)
  return result.stdout.trim()
}

function runPgCtl(command: string, args: string[]) {
  // PostgreSQL's Windows launcher can leave the server holding the parent's
  // output pipes open. Ignore those handles; pg_ctl writes server output to -l.
  const result = spawnSync(command, args, { stdio: 'ignore', timeout: 30_000, windowsHide: true })
  assert.equal(result.status, 0, `${command} ${args.join(' ')} failed`)
}

async function availablePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close((error) => error ? reject(error) : resolve(port))
    })
  })
}

const fixture = String.raw`
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE OR REPLACE FUNCTION public.user_company_ids() RETURNS SETOF UUID LANGUAGE sql STABLE AS $$ SELECT NULL::UUID WHERE false $$;

CREATE TABLE public.companies(id UUID PRIMARY KEY,currency TEXT NOT NULL);
CREATE TABLE public.customers(id UUID PRIMARY KEY,company_id UUID NOT NULL REFERENCES public.companies(id),UNIQUE(company_id,id));
CREATE TABLE public.vendors(id UUID PRIMARY KEY,company_id UUID NOT NULL REFERENCES public.companies(id),UNIQUE(company_id,id));
CREATE TABLE public.invoices(
  id UUID PRIMARY KEY,company_id UUID NOT NULL REFERENCES public.companies(id),customer_id UUID NOT NULL,
  currency TEXT NOT NULL,total NUMERIC(18,4) NOT NULL,amount_paid NUMERIC(18,4) NOT NULL DEFAULT 0,
  balance NUMERIC(18,4) NOT NULL DEFAULT 0,status TEXT NOT NULL,invoice_type TEXT NOT NULL DEFAULT 'STANDARD',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),UNIQUE(company_id,id)
);
CREATE TABLE public.bills(
  id UUID PRIMARY KEY,company_id UUID NOT NULL REFERENCES public.companies(id),vendor_id UUID NOT NULL,
  total NUMERIC(18,4) NOT NULL,amount_paid NUMERIC(18,4) NOT NULL DEFAULT 0,balance NUMERIC(18,4) NOT NULL DEFAULT 0,
  status TEXT NOT NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),UNIQUE(company_id,id)
);
CREATE TABLE public.payments(
  id UUID PRIMARY KEY,company_id UUID NOT NULL REFERENCES public.companies(id),legacy_id TEXT,amount NUMERIC(18,4) NOT NULL,
  invoice_id UUID,bill_id UUID,exchange_rate NUMERIC(18,8),deleted_at TIMESTAMPTZ
);
CREATE TABLE public.vendor_credits(
  id UUID PRIMARY KEY,company_id UUID NOT NULL REFERENCES public.companies(id),total NUMERIC(18,4) NOT NULL,status TEXT NOT NULL
);

INSERT INTO public.companies VALUES
  ('00000000-0000-0000-0000-000000000001','SAR'),
  ('00000000-0000-0000-0000-000000000002','AED');
INSERT INTO public.customers VALUES ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001');
INSERT INTO public.vendors VALUES ('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002');
INSERT INTO public.invoices(id,company_id,customer_id,currency,total,balance,status) VALUES
  ('30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','USD',100,100,'SENT');
INSERT INTO public.bills(id,company_id,vendor_id,total,balance,status) VALUES
  ('40000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001',200,200,'RECEIVED');
INSERT INTO public.payments(id,company_id,legacy_id,amount,invoice_id,exchange_rate) VALUES
  ('50000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','customer-payment',50,'30000000-0000-0000-0000-000000000001',1.25);
INSERT INTO public.payments(id,company_id,legacy_id,amount,bill_id,exchange_rate) VALUES
  ('50000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002','vendor-payment',75,'40000000-0000-0000-0000-000000000001',1);
`

const depositFixture = String.raw`
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE OR REPLACE FUNCTION public.user_company_ids() RETURNS SETOF UUID LANGUAGE sql STABLE AS $$ SELECT NULL::UUID WHERE false $$;

CREATE TABLE public.companies(id UUID PRIMARY KEY);
CREATE TABLE public.profiles(id UUID PRIMARY KEY);
CREATE TABLE public.chart_of_accounts(
  id UUID PRIMARY KEY,company_id UUID NOT NULL REFERENCES public.companies(id),account_no TEXT NOT NULL,
  UNIQUE(company_id,account_no)
);
CREATE TABLE public.payments(
  id UUID PRIMARY KEY,company_id UUID NOT NULL REFERENCES public.companies(id),amount NUMERIC(18,4) NOT NULL,
  UNIQUE(company_id,id)
);
CREATE TABLE public.bank_accounts(
  id UUID PRIMARY KEY,company_id UUID NOT NULL REFERENCES public.companies(id),account_id UUID,
  opening_balance NUMERIC(18,4) NOT NULL DEFAULT 0,deleted_at TIMESTAMPTZ
);
CREATE TABLE public.bank_transactions(
  id UUID PRIMARY KEY,company_id UUID NOT NULL REFERENCES public.companies(id),bank_account_id UUID NOT NULL,
  type TEXT NOT NULL,amount NUMERIC(18,4) NOT NULL,transaction_date DATE NOT NULL,status TEXT NOT NULL,
  source_type TEXT,source_id UUID
);
CREATE TABLE public.bank_reconciliations(
  id UUID PRIMARY KEY,company_id UUID NOT NULL REFERENCES public.companies(id),bank_account_id UUID NOT NULL,
  statement_date DATE NOT NULL,statement_balance NUMERIC(18,4) NOT NULL,reconciled_balance NUMERIC(18,4),
  status TEXT NOT NULL,completed_at TIMESTAMPTZ
);
CREATE TABLE public.quickbooks_migration_records(
  company_id UUID NOT NULL,entity_type TEXT NOT NULL,local_table TEXT,local_id UUID,source_id TEXT NOT NULL
);

INSERT INTO public.companies VALUES ('00000000-0000-0000-0000-000000000001');
INSERT INTO public.bank_transactions(id,company_id,bank_account_id,type,amount,transaction_date,status,source_type,source_id) VALUES (
  '60000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001',
  '70000000-0000-0000-0000-000000000001','CREDIT',125,'2026-01-15','MATCHED','QUICKBOOKS_DEPOSIT',
  '80000000-0000-0000-0000-000000000001'
);
INSERT INTO public.quickbooks_migration_records(company_id,entity_type,local_table,local_id,source_id) VALUES (
  '00000000-0000-0000-0000-000000000001','Deposit','bank_transactions',
  '60000000-0000-0000-0000-000000000001','12345'
);
`

const vendorCreditFixture = String.raw`
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE OR REPLACE FUNCTION public.user_company_ids() RETURNS SETOF UUID LANGUAGE sql STABLE AS $$ SELECT NULL::UUID WHERE false $$;

CREATE TABLE public.companies(id UUID PRIMARY KEY,currency TEXT NOT NULL);
CREATE TABLE public.vendors(id UUID PRIMARY KEY,company_id UUID NOT NULL REFERENCES public.companies(id));
CREATE TABLE public.chart_of_accounts(id UUID PRIMARY KEY,company_id UUID NOT NULL REFERENCES public.companies(id));
CREATE TABLE public.inventory_items(id UUID PRIMARY KEY,company_id UUID NOT NULL REFERENCES public.companies(id));
CREATE TABLE public.cost_centers(id UUID PRIMARY KEY,company_id UUID NOT NULL REFERENCES public.companies(id));
CREATE TABLE public.payments(id UUID PRIMARY KEY,company_id UUID NOT NULL REFERENCES public.companies(id));
CREATE TABLE public.bills(
  id UUID PRIMARY KEY,company_id UUID NOT NULL REFERENCES public.companies(id),vendor_id UUID NOT NULL REFERENCES public.vendors(id),
  deleted_at TIMESTAMPTZ,UNIQUE(company_id,id)
);
CREATE TABLE public.vendor_credits(
  id UUID PRIMARY KEY,company_id UUID NOT NULL REFERENCES public.companies(id),vendor_id UUID NOT NULL REFERENCES public.vendors(id),
  currency TEXT NOT NULL,subtotal NUMERIC(18,4) NOT NULL,tax_amount NUMERIC(18,4) NOT NULL,total NUMERIC(18,4) NOT NULL,
  applied_amount NUMERIC(18,4) NOT NULL DEFAULT 0,balance NUMERIC(18,4) NOT NULL DEFAULT 0,deleted_at TIMESTAMPTZ
);
CREATE TABLE public.payment_allocations(
  id UUID PRIMARY KEY,company_id UUID NOT NULL REFERENCES public.companies(id),payment_id UUID NOT NULL,bill_id UUID,
  credit_amount NUMERIC(18,4) NOT NULL DEFAULT 0,currency TEXT NOT NULL,local_credit_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_payment_id TEXT,source_line_key TEXT NOT NULL,source_target_id TEXT,source_credit_ids JSONB NOT NULL DEFAULT '[]'::jsonb
);
CREATE TABLE public.stock_movements(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),company_id UUID NOT NULL,source_type TEXT,source_id UUID,
  inventory_item_id UUID,reference TEXT
);
CREATE TABLE public.quickbooks_migration_records(
  company_id UUID NOT NULL,entity_type TEXT NOT NULL,source_id TEXT NOT NULL,local_table TEXT,local_id UUID,payload_hash TEXT NOT NULL
);

INSERT INTO public.companies VALUES ('00000000-0000-0000-0000-000000000001','AED');
INSERT INTO public.vendors VALUES
  ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001');
INSERT INTO public.bills VALUES (
  '20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',NULL
),(
  '20000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000002',NULL
);
INSERT INTO public.vendor_credits(id,company_id,vendor_id,currency,subtotal,tax_amount,total,balance) VALUES (
  '30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001','AED',100,0,100,100
);
INSERT INTO public.payments VALUES ('40000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001');
`

test('migration 056 backfills allocation currency without payments.currency and is idempotent', { timeout: 60_000 }, async (context) => {
  const initdb = executable('initdb')
  const pgCtl = executable('pg_ctl')
  const psql = executable('psql')
  if (spawnSync(initdb, ['--version'], { encoding: 'utf8' }).status !== 0 || spawnSync(psql, ['--version'], { encoding: 'utf8' }).status !== 0) {
    context.skip('PostgreSQL 15+ binaries are required for executable migration tests.')
    return
  }

  const root = mkdtempSync(join(tmpdir(), 'hisab-migration-056-'))
  const data = join(root, 'data')
  const fixturePath = join(root, 'fixture.sql')
  const logPath = join(root, 'postgres.log')
  const port = await availablePort()
  writeFileSync(fixturePath, fixture)
  let started = false
  try {
    run(initdb, ['-D', data, '-A', 'trust', '-U', 'postgres', '--no-locale', '--encoding=UTF8'])
    runPgCtl(pgCtl, ['-D', data, '-l', logPath, '-o', `-F -p ${port} -h 127.0.0.1`, '-w', 'start'])
    started = true
    const connection = ['-X', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', 'postgres']
    run(psql, [...connection, '-f', fixturePath])
    const migration = join(process.cwd(), 'supabase', 'migrations', '056_payment_allocations.sql')
    run(psql, [...connection, '-f', migration])
    run(psql, [...connection, '-f', migration])
    const currencies = run(psql, [...connection, '-At', '-c', "SELECT source_payment_id||':'||currency FROM public.payment_allocations ORDER BY source_payment_id"])
    assert.deepEqual(currencies.split(/\r?\n/), ['customer-payment:USD', 'vendor-payment:AED'])
    const count = run(psql, [...connection, '-At', '-c', 'SELECT COUNT(*) FROM public.payment_allocations'])
    assert.equal(count, '2')
    const paymentCurrencyExists = run(psql, [...connection, '-At', '-c', "SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='payments' AND column_name='currency')"])
    assert.equal(paymentCurrencyExists, 'f')
  } finally {
    if (started) spawnSync(pgCtl, ['-D', data, '-m', 'immediate', '-w', 'stop'], { stdio: 'ignore', timeout: 30_000, windowsHide: true })
    rmSync(root, { recursive: true, force: true })
  }
})

test('migration 057 creates deposit tables against canonical account IDs and is idempotent', { timeout: 60_000 }, async (context) => {
  const initdb = executable('initdb')
  const pgCtl = executable('pg_ctl')
  const psql = executable('psql')
  if (spawnSync(initdb, ['--version'], { encoding: 'utf8' }).status !== 0 || spawnSync(psql, ['--version'], { encoding: 'utf8' }).status !== 0) {
    context.skip('PostgreSQL 15+ binaries are required for executable migration tests.')
    return
  }

  const root = mkdtempSync(join(tmpdir(), 'hisab-migration-057-'))
  const data = join(root, 'data')
  const fixturePath = join(root, 'fixture.sql')
  const logPath = join(root, 'postgres.log')
  const port = await availablePort()
  writeFileSync(fixturePath, depositFixture)
  let started = false
  try {
    run(initdb, ['-D', data, '-A', 'trust', '-U', 'postgres', '--no-locale', '--encoding=UTF8'])
    runPgCtl(pgCtl, ['-D', data, '-l', logPath, '-o', `-F -p ${port} -h 127.0.0.1`, '-w', 'start'])
    started = true
    const connection = ['-X', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', 'postgres']
    run(psql, [...connection, '-f', fixturePath])
    const migration = join(process.cwd(), 'supabase', 'migrations', '057_quickbooks_deposit_materialization.sql')
    run(psql, [...connection, '-f', migration])
    run(psql, [...connection, '-f', migration])

    const accountConstraints = run(psql, [...connection, '-At', '-c', String.raw`
      SELECT conname||':'||pg_get_constraintdef(oid)
      FROM pg_constraint
      WHERE conname IN ('payments_deposit_account_fkey','deposit_allocations_account_fkey')
      ORDER BY conname
    `])
    assert.match(accountConstraints, /deposit_allocations_account_fkey:FOREIGN KEY \(account_id\) REFERENCES chart_of_accounts\(id\)/)
    assert.match(accountConstraints, /payments_deposit_account_fkey:FOREIGN KEY \(deposit_account_id\) REFERENCES chart_of_accounts\(id\)/)

    const createdTables = run(psql, [...connection, '-At', '-c', String.raw`
      SELECT COUNT(*) FROM information_schema.tables
      WHERE table_schema='public' AND table_name IN ('deposit_allocations','deposit_audit_log','bank_reconciliation_items')
    `])
    assert.equal(createdTables, '3')

    const compositeAccountKeyExists = run(psql, [...connection, '-At', '-c', String.raw`
      SELECT EXISTS(
        SELECT 1 FROM pg_constraint
        WHERE conrelid='public.chart_of_accounts'::regclass
          AND contype IN ('p','u')
          AND pg_get_constraintdef(oid) LIKE '%(company_id, id)%'
      )
    `])
    assert.equal(compositeAccountKeyExists, 'f')

    const restoredSource = run(psql, [...connection, '-At', '-c', String.raw`
      SELECT information_schema.columns.data_type||':'||transaction.source_id
      FROM public.bank_transactions transaction
      JOIN information_schema.columns ON table_schema='public' AND table_name='bank_transactions' AND column_name='source_id'
      WHERE transaction.id='60000000-0000-0000-0000-000000000001'
    `])
    assert.equal(restoredSource, 'text:12345')

    const policyCount = run(psql, [...connection, '-At', '-c', String.raw`
      SELECT COUNT(*) FROM pg_policies
      WHERE schemaname='public' AND tablename IN ('deposit_allocations','deposit_audit_log','bank_reconciliation_items')
    `])
    assert.equal(policyCount, '6')
  } finally {
    if (started) spawnSync(pgCtl, ['-D', data, '-m', 'immediate', '-w', 'stop'], { stdio: 'ignore', timeout: 30_000, windowsHide: true })
    rmSync(root, { recursive: true, force: true })
  }
})

test('migration 058 uses company currency for bills without a currency column', { timeout: 60_000 }, async (context) => {
  const initdb = executable('initdb')
  const pgCtl = executable('pg_ctl')
  const psql = executable('psql')
  if (spawnSync(initdb, ['--version'], { encoding: 'utf8' }).status !== 0 || spawnSync(psql, ['--version'], { encoding: 'utf8' }).status !== 0) {
    context.skip('PostgreSQL 15+ binaries are required for executable migration tests.')
    return
  }

  const root = mkdtempSync(join(tmpdir(), 'hisab-migration-058-'))
  const data = join(root, 'data')
  const fixturePath = join(root, 'fixture.sql')
  const logPath = join(root, 'postgres.log')
  const port = await availablePort()
  writeFileSync(fixturePath, vendorCreditFixture)
  let started = false
  try {
    run(initdb, ['-D', data, '-A', 'trust', '-U', 'postgres', '--no-locale', '--encoding=UTF8'])
    runPgCtl(pgCtl, ['-D', data, '-l', logPath, '-o', `-F -p ${port} -h 127.0.0.1`, '-w', 'start'])
    started = true
    const connection = ['-X', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', 'postgres']
    run(psql, [...connection, '-f', fixturePath])
    const migration = join(process.cwd(), 'supabase', 'migrations', '058_vendor_credit_materialization.sql')
    run(psql, [...connection, '-f', migration])

    run(psql, [...connection, '-c', String.raw`
      INSERT INTO public.payment_allocations(
        id,company_id,payment_id,bill_id,credit_amount,currency,local_credit_ids,
        source_payment_id,source_line_key,source_target_id,source_credit_ids
      ) VALUES (
        '50000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001',
        '40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',25,'AED',
        '["30000000-0000-0000-0000-000000000001"]'::jsonb,'qb-payment','line-1','qb-bill',
        '["qb-credit"]'::jsonb
      )
    `])

    const application = run(psql, [...connection, '-At', '-c', String.raw`
      SELECT amount||':'||currency FROM public.vendor_credit_applications
      WHERE payment_allocation_id='50000000-0000-0000-0000-000000000001'
    `])
    assert.equal(application, '25.0000:AED')

    const billCurrencyExists = run(psql, [...connection, '-At', '-c', String.raw`
      SELECT EXISTS(SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='bills' AND column_name='currency')
    `])
    assert.equal(billCurrencyExists, 'f')

    const invalidVendor = spawnSync(psql, [...connection, '-c', String.raw`
      INSERT INTO public.payment_allocations(
        id,company_id,payment_id,bill_id,credit_amount,currency,local_credit_ids,
        source_payment_id,source_line_key,source_target_id,source_credit_ids
      ) VALUES (
        '50000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001',
        '40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002',10,'AED',
        '["30000000-0000-0000-0000-000000000001"]'::jsonb,'qb-payment','line-2','qb-bill-2',
        '["qb-credit"]'::jsonb
      )
    `], { encoding: 'utf8', env: { ...process.env, PGCONNECT_TIMEOUT: '5' }, timeout: 30_000, windowsHide: true })
    assert.notEqual(invalidVendor.status, 0)
    assert.match(invalidVendor.stderr, /Vendor credit and bill must belong to the same vendor/)
  } finally {
    if (started) spawnSync(pgCtl, ['-D', data, '-m', 'immediate', '-w', 'stop'], { stdio: 'ignore', timeout: 30_000, windowsHide: true })
    rmSync(root, { recursive: true, force: true })
  }
})
