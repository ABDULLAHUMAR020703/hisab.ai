-- hisab.ai Supabase bootstrap
-- Creates the public application tables, links app users to Supabase Auth users,
-- and loads the current local seed data from dev.db.
-- Run this in Supabase SQL Editor or with: npm run supabase:apply

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "authUserId" UUID,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "password" TEXT,
    "role" TEXT NOT NULL DEFAULT 'ACCOUNTANT',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChartOfAccount" (
    "id" TEXT NOT NULL,
    "accountNo" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentNo" TEXT,
    "accountType" TEXT NOT NULL,
    "subType" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChartOfAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostCenter" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'PROJECT',
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CostCenter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" TEXT NOT NULL,
    "entryNo" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "reference" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "totalDebit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalCredit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalLine" (
    "id" TEXT NOT NULL,
    "journalId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "costCenterId" TEXT,
    "description" TEXT,
    "debit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "credit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "taxRate" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "JournalLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "customerNo" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "city" TEXT,
    "country" TEXT,
    "taxId" TEXT,
    "creditLimit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paymentTerms" INTEGER NOT NULL DEFAULT 30,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vendor" (
    "id" TEXT NOT NULL,
    "vendorNo" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "city" TEXT,
    "country" TEXT,
    "taxId" TEXT,
    "paymentTerms" INTEGER NOT NULL DEFAULT 30,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "invoiceNo" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "subtotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "taxAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "amountPaid" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,
    "terms" TEXT,
    "isRecurring" BOOLEAN NOT NULL DEFAULT false,
    "recurringDay" INTEGER,
    "nextDueDate" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLine" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "accountId" TEXT,
    "costCenterId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "unitPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "taxRate" DOUBLE PRECISION NOT NULL DEFAULT 15,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bill" (
    "id" TEXT NOT NULL,
    "billNo" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "subtotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "taxAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "amountPaid" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,
    "reference" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Bill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillLine" (
    "id" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "accountId" TEXT,
    "costCenterId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "unitPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "taxRate" DOUBLE PRECISION NOT NULL DEFAULT 15,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "BillLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "expenseNo" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "taxAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "receiptId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseLine" (
    "id" TEXT NOT NULL,
    "expenseId" TEXT NOT NULL,
    "accountId" TEXT,
    "description" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "taxRate" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "ExpenseLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "paymentNo" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'BANK_TRANSFER',
    "reference" TEXT,
    "notes" TEXT,
    "invoiceId" TEXT,
    "billId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "employeeNo" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "department" TEXT,
    "position" TEXT,
    "joiningDate" TIMESTAMP(3) NOT NULL,
    "salary" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "salaryType" TEXT NOT NULL DEFAULT 'MONTHLY',
    "bankAccount" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollEntry" (
    "id" TEXT NOT NULL,
    "payrollNo" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "basicSalary" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "allowances" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "deductions" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "taxAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "netSalary" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "paidAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollLine" (
    "id" TEXT NOT NULL,
    "payrollId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "PayrollLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryItem" (
    "id" TEXT NOT NULL,
    "itemCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'PCS',
    "costPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "salePrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "minQuantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxRate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'VAT',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Receipt" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "vendor" TEXT,
    "amount" DOUBLE PRECISION,
    "date" TIMESTAMP(3),
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'UNPROCESSED',
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanySettings" (
    "id" TEXT NOT NULL,
    "companyName" TEXT NOT NULL DEFAULT 'NETKOM COMPANY FOR COMMUNICATION',
    "legalName" TEXT,
    "taxId" TEXT,
    "address" TEXT,
    "city" TEXT,
    "country" TEXT NOT NULL DEFAULT 'Saudi Arabia',
    "phone" TEXT,
    "email" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'SAR',
    "fiscalYearStart" TEXT NOT NULL DEFAULT '01-01',
    "zatcaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanySettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sequence" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "nextNo" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Sequence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_authUserId_key" ON "User"("authUserId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "AppSession_token_key" ON "AppSession"("token");

-- CreateIndex
CREATE UNIQUE INDEX "ChartOfAccount_accountNo_key" ON "ChartOfAccount"("accountNo");

-- CreateIndex
CREATE UNIQUE INDEX "CostCenter_code_key" ON "CostCenter"("code");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_entryNo_key" ON "JournalEntry"("entryNo");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_customerNo_key" ON "Customer"("customerNo");

-- CreateIndex
CREATE UNIQUE INDEX "Vendor_vendorNo_key" ON "Vendor"("vendorNo");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_invoiceNo_key" ON "Invoice"("invoiceNo");

-- CreateIndex
CREATE UNIQUE INDEX "Bill_billNo_key" ON "Bill"("billNo");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_expenseNo_key" ON "Expense"("expenseNo");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_paymentNo_key" ON "Payment"("paymentNo");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_employeeNo_key" ON "Employee"("employeeNo");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollEntry_payrollNo_key" ON "PayrollEntry"("payrollNo");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItem_itemCode_key" ON "InventoryItem"("itemCode");

-- CreateIndex
CREATE UNIQUE INDEX "Sequence_type_key" ON "Sequence"("type");

-- Link app users to Supabase Auth users when this runs inside a Supabase project.
ALTER TABLE "User" ADD CONSTRAINT "User_authUserId_fkey" FOREIGN KEY ("authUserId") REFERENCES auth.users("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppSession" ADD CONSTRAINT "AppSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ChartOfAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ChartOfAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillLine" ADD CONSTRAINT "BillLine_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillLine" ADD CONSTRAINT "BillLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ChartOfAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillLine" ADD CONSTRAINT "BillLine_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseLine" ADD CONSTRAINT "ExpenseLine_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseLine" ADD CONSTRAINT "ExpenseLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ChartOfAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollEntry" ADD CONSTRAINT "PayrollEntry_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollLine" ADD CONSTRAINT "PayrollLine_payrollId_fkey" FOREIGN KEY ("payrollId") REFERENCES "PayrollEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed Supabase Auth users.
-- These passwords match the local demo accounts: admin123 and accountant123.
INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token,
  email_change, email_change_token_new, recovery_token
) VALUES
  ('11111111-1111-4111-8111-111111111111'::uuid, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'admin@hisab.ai', crypt('admin123', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"name":"System Administrator"}'::jsonb, now(), now(), '', '', '', ''),
  ('22222222-2222-4222-8222-222222222222'::uuid, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'accountant@hisab.ai', crypt('accountant123', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"name":"Senior Accountant"}'::jsonb, now(), now(), '', '', '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.identities (
  id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
) VALUES
  ('11111111-1111-4111-8111-111111111111'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, '11111111-1111-4111-8111-111111111111', '{"sub":"11111111-1111-4111-8111-111111111111","email":"admin@hisab.ai"}'::jsonb, 'email', now(), now(), now()),
  ('22222222-2222-4222-8222-222222222222'::uuid, '22222222-2222-4222-8222-222222222222'::uuid, '22222222-2222-4222-8222-222222222222', '{"sub":"22222222-2222-4222-8222-222222222222","email":"accountant@hisab.ai"}'::jsonb, 'email', now(), now(), now())
ON CONFLICT (provider, provider_id) DO NOTHING;

INSERT INTO "User" ("id", "name", "email", "password", "role", "isActive", "createdAt", "updatedAt") VALUES
  ('cmpdb033p0001r0ndmd3og9tk', 'System Administrator', 'admin@hisab.ai', '$2b$10$wFwXkPG0Lict.DuUwI9M5eCgIL9bYXtLZTRsIjiMsy9oSf9siH7ne', 'ADMIN', true, '2026-05-20T00:08:28.597+00:00'::timestamp, '2026-05-20T00:08:28.597+00:00'::timestamp),
  ('cmpdb037i0002r0ndho34647p', 'Senior Accountant', 'accountant@hisab.ai', '$2b$10$9Cf1HMJ4zkiC.P7PbYxbAubSGlz83NgAedb5Wlyd28YBdaBGtcYci', 'ACCOUNTANT', true, '2026-05-20T00:08:28.734+00:00'::timestamp, '2026-05-20T00:08:28.734+00:00'::timestamp)
ON CONFLICT DO NOTHING;
UPDATE "User" SET "authUserId" = '11111111-1111-4111-8111-111111111111'::uuid WHERE "id" = 'cmpdb033p0001r0ndmd3og9tk';
UPDATE "User" SET "authUserId" = '22222222-2222-4222-8222-222222222222'::uuid WHERE "id" = 'cmpdb037i0002r0ndho34647p';

INSERT INTO "CompanySettings" ("id", "companyName", "legalName", "taxId", "address", "city", "country", "phone", "email", "currency", "fiscalYearStart", "zatcaEnabled", "createdAt", "updatedAt") VALUES
  ('cmpdb02yx0000r0ndxozig7hv', 'NETKOM COMPANY FOR COMMUNICATION', 'NETKOM COMPANY FOR COMMUNICATION LLC', NULL, NULL, NULL, 'Saudi Arabia', NULL, NULL, 'SAR', '01-01', false, '2026-05-20T00:08:28.425+00:00'::timestamp, '2026-05-20T00:08:28.425+00:00'::timestamp)
ON CONFLICT DO NOTHING;

INSERT INTO "ChartOfAccount" ("id", "accountNo", "fullName", "name", "parentNo", "accountType", "subType", "isActive", "description", "balance", "createdAt", "updatedAt") VALUES
  ('cmpdb037y0003r0nd7xhakvnl', '10', 'Assets', 'ASSETS', NULL, 'Asset', 'Header', true, NULL, 0, '2026-05-20T00:08:28.750+00:00'::timestamp, '2026-05-20T00:08:28.750+00:00'::timestamp),
  ('cmpdb03860004r0nd6doqico8', '11', 'Current Assets', 'CURRENT ASSETS', '10', 'Asset', 'Header', true, NULL, 0, '2026-05-20T00:08:28.758+00:00'::timestamp, '2026-05-20T00:08:28.758+00:00'::timestamp),
  ('cmpdb038c0005r0ndba6d40oz', '1101', 'Cash and Bank', 'CASH AND BANK', '11', 'Asset', 'Bank', true, NULL, 0, '2026-05-20T00:08:28.764+00:00'::timestamp, '2026-05-20T00:08:28.764+00:00'::timestamp),
  ('cmpdb038h0006r0ndvofw7dc5', '110101', 'Cash In Hand', 'CASH IN HAND', '1101', 'Asset', 'Cash', true, NULL, 0, '2026-05-20T00:08:28.769+00:00'::timestamp, '2026-05-20T00:08:28.769+00:00'::timestamp),
  ('cmpdb038n0007r0nd0upakyve', '110102', 'Petty Cash', 'PETTY CASH', '1101', 'Asset', 'Cash', true, NULL, 0, '2026-05-20T00:08:28.775+00:00'::timestamp, '2026-05-20T00:08:28.775+00:00'::timestamp),
  ('cmpdb038s0008r0ndf8m2yik5', '110103', 'Bank - Al Rajhi', 'BANK - AL RAJHI', '1101', 'Asset', 'Bank', true, NULL, 0, '2026-05-20T00:08:28.781+00:00'::timestamp, '2026-05-20T00:08:28.781+00:00'::timestamp),
  ('cmpdb038y0009r0nde0kuaag6', '110104', 'Bank - Riyadh Bank', 'BANK - RIYADH BANK', '1101', 'Asset', 'Bank', true, NULL, 0, '2026-05-20T00:08:28.786+00:00'::timestamp, '2026-05-20T00:08:28.786+00:00'::timestamp),
  ('cmpdb0394000ar0ndd7beun2t', '110105', 'Bank - NCB', 'BANK - NCB', '1101', 'Asset', 'Bank', true, NULL, 0, '2026-05-20T00:08:28.792+00:00'::timestamp, '2026-05-20T00:08:28.792+00:00'::timestamp),
  ('cmpdb0399000br0nd8cm5va73', '1102', 'Accounts Receivable', 'ACCOUNTS RECEIVABLE', '11', 'Asset', 'AccountsReceivable', true, NULL, 0, '2026-05-20T00:08:28.797+00:00'::timestamp, '2026-05-20T00:08:28.797+00:00'::timestamp),
  ('cmpdb039f000cr0ndljpp5vxm', '110201', 'Trade Debtors', 'TRADE DEBTORS', '1102', 'Asset', 'AccountsReceivable', true, NULL, 0, '2026-05-20T00:08:28.803+00:00'::timestamp, '2026-05-20T00:08:28.803+00:00'::timestamp),
  ('cmpdb039l000dr0ndo4mazdbf', '110202', 'Notes Receivable', 'NOTES RECEIVABLE', '1102', 'Asset', 'OtherCurrentAsset', true, NULL, 0, '2026-05-20T00:08:28.809+00:00'::timestamp, '2026-05-20T00:08:28.809+00:00'::timestamp),
  ('cmpdb039s000er0nd9srwddpe', '1103', 'Prepayments and Advances', 'PREPAYMENTS & ADVANCES', '11', 'Asset', 'OtherCurrentAsset', true, NULL, 0, '2026-05-20T00:08:28.816+00:00'::timestamp, '2026-05-20T00:08:28.816+00:00'::timestamp),
  ('cmpdb039y000fr0nd2hrhk2t5', '110301', 'Prepaid Expenses', 'PREPAID EXPENSES', '1103', 'Asset', 'OtherCurrentAsset', true, NULL, 0, '2026-05-20T00:08:28.822+00:00'::timestamp, '2026-05-20T00:08:28.822+00:00'::timestamp),
  ('cmpdb03a3000gr0ndh1m8a3bt', '110302', 'Advance to Suppliers', 'ADVANCE TO SUPPLIERS', '1103', 'Asset', 'OtherCurrentAsset', true, NULL, 0, '2026-05-20T00:08:28.827+00:00'::timestamp, '2026-05-20T00:08:28.827+00:00'::timestamp),
  ('cmpdb03a8000hr0ndd0jzjlaj', '110303', 'Employee Advances', 'EMPLOYEE ADVANCES', '1103', 'Asset', 'OtherCurrentAsset', true, NULL, 0, '2026-05-20T00:08:28.832+00:00'::timestamp, '2026-05-20T00:08:28.832+00:00'::timestamp),
  ('cmpdb03ae000ir0ndwczmql0b', '1104', 'Inventory', 'INVENTORY', '11', 'Asset', 'OtherCurrentAsset', true, NULL, 0, '2026-05-20T00:08:28.838+00:00'::timestamp, '2026-05-20T00:08:28.838+00:00'::timestamp),
  ('cmpdb03aj000jr0nd6f782j7v', '110401', 'Goods Inventory', 'GOODS INVENTORY', '1104', 'Asset', 'OtherCurrentAsset', true, NULL, 0, '2026-05-20T00:08:28.843+00:00'::timestamp, '2026-05-20T00:08:28.843+00:00'::timestamp),
  ('cmpdb03ao000kr0ndpre7ivtf', '12', 'Fixed Assets', 'FIXED ASSETS', '10', 'Asset', 'Header', true, NULL, 0, '2026-05-20T00:08:28.848+00:00'::timestamp, '2026-05-20T00:08:28.848+00:00'::timestamp),
  ('cmpdb03at000lr0ndgggmjhsn', '1201', 'Property and Equipment', 'PROPERTY & EQUIPMENT', '12', 'Asset', 'FixedAsset', true, NULL, 0, '2026-05-20T00:08:28.853+00:00'::timestamp, '2026-05-20T00:08:28.853+00:00'::timestamp),
  ('cmpdb03ay000mr0ndczpd4r7h', '120101', 'Furniture and Fixtures', 'FURNITURE & FIXTURES', '1201', 'Asset', 'FixedAsset', true, NULL, 0, '2026-05-20T00:08:28.858+00:00'::timestamp, '2026-05-20T00:08:28.858+00:00'::timestamp),
  ('cmpdb03b3000nr0ndi0ve2co2', '120102', 'Computer Equipment', 'COMPUTER EQUIPMENT', '1201', 'Asset', 'FixedAsset', true, NULL, 0, '2026-05-20T00:08:28.863+00:00'::timestamp, '2026-05-20T00:08:28.863+00:00'::timestamp),
  ('cmpdb03b9000or0nd7n7h4rmg', '120103', 'Vehicles', 'VEHICLES', '1201', 'Asset', 'FixedAsset', true, NULL, 0, '2026-05-20T00:08:28.869+00:00'::timestamp, '2026-05-20T00:08:28.869+00:00'::timestamp),
  ('cmpdb03bd000pr0nd9hghsnas', '120104', 'Office Equipment', 'OFFICE EQUIPMENT', '1201', 'Asset', 'FixedAsset', true, NULL, 0, '2026-05-20T00:08:28.873+00:00'::timestamp, '2026-05-20T00:08:28.873+00:00'::timestamp),
  ('cmpdb03bi000qr0nd53f6dbg9', '1202', 'Accumulated Depreciation', 'ACCUMULATED DEPRECIATION', '12', 'Asset', 'FixedAsset', true, NULL, 0, '2026-05-20T00:08:28.878+00:00'::timestamp, '2026-05-20T00:08:28.878+00:00'::timestamp),
  ('cmpdb03bp000rr0nd5zap9lkf', '20', 'Liabilities', 'LIABILITIES', NULL, 'Liability', 'Header', true, NULL, 0, '2026-05-20T00:08:28.885+00:00'::timestamp, '2026-05-20T00:08:28.885+00:00'::timestamp),
  ('cmpdb03bu000sr0nd1993w60v', '21', 'Current Liabilities', 'CURRENT LIABILITIES', '20', 'Liability', 'Header', true, NULL, 0, '2026-05-20T00:08:28.890+00:00'::timestamp, '2026-05-20T00:08:28.890+00:00'::timestamp),
  ('cmpdb03by000tr0ndk9n9a9z1', '2101', 'Accounts Payable', 'ACCOUNTS PAYABLE', '21', 'Liability', 'AccountsPayable', true, NULL, 0, '2026-05-20T00:08:28.894+00:00'::timestamp, '2026-05-20T00:08:28.894+00:00'::timestamp),
  ('cmpdb03c6000ur0ndalbbiu5d', '210101', 'Trade Creditors', 'TRADE CREDITORS', '2101', 'Liability', 'AccountsPayable', true, NULL, 0, '2026-05-20T00:08:28.902+00:00'::timestamp, '2026-05-20T00:08:28.902+00:00'::timestamp),
  ('cmpdb03cb000vr0nd52dj2hjb', '2102', 'VAT Payable', 'VAT PAYABLE', '21', 'Liability', 'OtherCurrentLiability', true, NULL, 0, '2026-05-20T00:08:28.907+00:00'::timestamp, '2026-05-20T00:08:28.907+00:00'::timestamp),
  ('cmpdb03ch000wr0ndm531mj0g', '210201', 'VAT Output (Sales)', 'VAT OUTPUT', '2102', 'Liability', 'OtherCurrentLiability', true, NULL, 0, '2026-05-20T00:08:28.913+00:00'::timestamp, '2026-05-20T00:08:28.913+00:00'::timestamp),
  ('cmpdb03cn000xr0nd0aogpxxn', '210202', 'VAT Input (Purchases)', 'VAT INPUT', '2102', 'Liability', 'OtherCurrentLiability', true, NULL, 0, '2026-05-20T00:08:28.919+00:00'::timestamp, '2026-05-20T00:08:28.919+00:00'::timestamp),
  ('cmpdb03cr000yr0ndh828555b', '2103', 'Accrued Liabilities', 'ACCRUED LIABILITIES', '21', 'Liability', 'OtherCurrentLiability', true, NULL, 0, '2026-05-20T00:08:28.923+00:00'::timestamp, '2026-05-20T00:08:28.923+00:00'::timestamp),
  ('cmpdb03cv000zr0ndhdy2lhvf', '210301', 'Accrued Salaries', 'ACCRUED SALARIES', '2103', 'Liability', 'OtherCurrentLiability', true, NULL, 0, '2026-05-20T00:08:28.927+00:00'::timestamp, '2026-05-20T00:08:28.927+00:00'::timestamp),
  ('cmpdb03d10010r0ndckaxvaiy', '210302', 'Accrued Expenses', 'ACCRUED EXPENSES', '2103', 'Liability', 'OtherCurrentLiability', true, NULL, 0, '2026-05-20T00:08:28.933+00:00'::timestamp, '2026-05-20T00:08:28.933+00:00'::timestamp),
  ('cmpdb03d60011r0nd5sqruv6e', '2104', 'Employee Benefits Payable', 'EMPLOYEE BENEFITS', '21', 'Liability', 'OtherCurrentLiability', true, NULL, 0, '2026-05-20T00:08:28.938+00:00'::timestamp, '2026-05-20T00:08:28.938+00:00'::timestamp),
  ('cmpdb03da0012r0nddarttixx', '22', 'Long-term Liabilities', 'LONG-TERM LIABILITIES', '20', 'Liability', 'Header', true, NULL, 0, '2026-05-20T00:08:28.942+00:00'::timestamp, '2026-05-20T00:08:28.942+00:00'::timestamp),
  ('cmpdb03dg0013r0ndvttex8tw', '2201', 'Loans Payable', 'LOANS PAYABLE', '22', 'Liability', 'LongTermLiability', true, NULL, 0, '2026-05-20T00:08:28.948+00:00'::timestamp, '2026-05-20T00:08:28.948+00:00'::timestamp),
  ('cmpdb03dl0014r0ndejroy2d9', '220101', 'Bank Loans', 'BANK LOANS', '2201', 'Liability', 'LongTermLiability', true, NULL, 0, '2026-05-20T00:08:28.953+00:00'::timestamp, '2026-05-20T00:08:28.953+00:00'::timestamp),
  ('cmpdb03dr0015r0ndkv3mgn2a', '30', 'Equity', 'EQUITY', NULL, 'Equity', 'Header', true, NULL, 0, '2026-05-20T00:08:28.959+00:00'::timestamp, '2026-05-20T00:08:28.959+00:00'::timestamp),
  ('cmpdb03dy0016r0ndxtx9inlf', '3001', 'Share Capital', 'SHARE CAPITAL', '30', 'Equity', 'Equity', true, NULL, 0, '2026-05-20T00:08:28.966+00:00'::timestamp, '2026-05-20T00:08:28.966+00:00'::timestamp),
  ('cmpdb03e40017r0ndb1475w27', '3002', 'Retained Earnings', 'RETAINED EARNINGS', '30', 'Equity', 'RetainedEarnings', true, NULL, 0, '2026-05-20T00:08:28.972+00:00'::timestamp, '2026-05-20T00:08:28.972+00:00'::timestamp),
  ('cmpdb03ea0018r0ndvvnv92id', '3003', 'Current Year Profit/Loss', 'CURRENT YEAR PROFIT', '30', 'Equity', 'RetainedEarnings', true, NULL, 0, '2026-05-20T00:08:28.978+00:00'::timestamp, '2026-05-20T00:08:28.978+00:00'::timestamp),
  ('cmpdb03ei0019r0nd8eumeoys', '40', 'Income', 'INCOME', NULL, 'Income', 'Header', true, NULL, 0, '2026-05-20T00:08:28.986+00:00'::timestamp, '2026-05-20T00:08:28.986+00:00'::timestamp),
  ('cmpdb03em001ar0ndofyyls8u', '4001', 'Sales Revenue', 'SALES REVENUE', '40', 'Income', 'Income', true, NULL, 0, '2026-05-20T00:08:28.990+00:00'::timestamp, '2026-05-20T00:08:28.990+00:00'::timestamp),
  ('cmpdb03es001br0ndywpoz3cc', '400101', 'Services Revenue', 'SERVICES REVENUE', '4001', 'Income', 'Income', true, NULL, 0, '2026-05-20T00:08:28.996+00:00'::timestamp, '2026-05-20T00:08:28.996+00:00'::timestamp),
  ('cmpdb03ez001cr0ndjga1em2z', '400102', 'Product Sales', 'PRODUCT SALES', '4001', 'Income', 'Income', true, NULL, 0, '2026-05-20T00:08:29.003+00:00'::timestamp, '2026-05-20T00:08:29.003+00:00'::timestamp),
  ('cmpdb03f4001dr0ndwd0gpcz4', '400103', 'Telecom Services Revenue', 'TELECOM SERVICES', '4001', 'Income', 'Income', true, NULL, 0, '2026-05-20T00:08:29.008+00:00'::timestamp, '2026-05-20T00:08:29.008+00:00'::timestamp),
  ('cmpdb03fb001er0ndgnqj7gt8', '4002', 'Other Income', 'OTHER INCOME', '40', 'Income', 'OtherIncome', true, NULL, 0, '2026-05-20T00:08:29.015+00:00'::timestamp, '2026-05-20T00:08:29.015+00:00'::timestamp),
  ('cmpdb03fh001fr0nd0rm8rkuf', '400201', 'Interest Income', 'INTEREST INCOME', '4002', 'Income', 'OtherIncome', true, NULL, 0, '2026-05-20T00:08:29.021+00:00'::timestamp, '2026-05-20T00:08:29.021+00:00'::timestamp),
  ('cmpdb03fm001gr0ndjtb55hdv', '400202', 'Miscellaneous Income', 'MISCELLANEOUS INCOME', '4002', 'Income', 'OtherIncome', true, NULL, 0, '2026-05-20T00:08:29.026+00:00'::timestamp, '2026-05-20T00:08:29.026+00:00'::timestamp),
  ('cmpdb03fs001hr0ndxnz2gelf', '50', 'Cost of Sales', 'COST OF SALES', NULL, 'CostOfGoodsSold', 'Header', true, NULL, 0, '2026-05-20T00:08:29.032+00:00'::timestamp, '2026-05-20T00:08:29.032+00:00'::timestamp),
  ('cmpdb03fy001ir0ndk40x9et2', '5001', 'Direct Costs', 'DIRECT COSTS', '50', 'CostOfGoodsSold', 'CostOfGoodsSold', true, NULL, 0, '2026-05-20T00:08:29.038+00:00'::timestamp, '2026-05-20T00:08:29.038+00:00'::timestamp),
  ('cmpdb03g3001jr0ndndj2m1y2', '500101', 'Cost of Services', 'COST OF SERVICES', '5001', 'CostOfGoodsSold', 'CostOfGoodsSold', true, NULL, 0, '2026-05-20T00:08:29.043+00:00'::timestamp, '2026-05-20T00:08:29.043+00:00'::timestamp),
  ('cmpdb03ga001kr0ndek3jwwq8', '500102', 'Cost of Goods Sold', 'COST OF GOODS SOLD', '5001', 'CostOfGoodsSold', 'CostOfGoodsSold', true, NULL, 0, '2026-05-20T00:08:29.050+00:00'::timestamp, '2026-05-20T00:08:29.050+00:00'::timestamp),
  ('cmpdb03gg001lr0ndkspe4fv5', '500103', 'Direct Labor', 'DIRECT LABOR', '5001', 'CostOfGoodsSold', 'CostOfGoodsSold', true, NULL, 0, '2026-05-20T00:08:29.056+00:00'::timestamp, '2026-05-20T00:08:29.056+00:00'::timestamp),
  ('cmpdb03gk001mr0ndxvh2uu14', '60', 'Operating Expenses', 'OPERATING EXPENSES', NULL, 'Expense', 'Header', true, NULL, 0, '2026-05-20T00:08:29.060+00:00'::timestamp, '2026-05-20T00:08:29.060+00:00'::timestamp),
  ('cmpdb03gr001nr0ndfnpbbrjg', '6001', 'Salaries and Wages', 'SALARIES & WAGES', '60', 'Expense', 'Expense', true, NULL, 0, '2026-05-20T00:08:29.067+00:00'::timestamp, '2026-05-20T00:08:29.067+00:00'::timestamp),
  ('cmpdb03gx001or0ndgeh3ljr8', '600101', 'Basic Salaries', 'BASIC SALARIES', '6001', 'Expense', 'Expense', true, NULL, 0, '2026-05-20T00:08:29.073+00:00'::timestamp, '2026-05-20T00:08:29.073+00:00'::timestamp),
  ('cmpdb03h2001pr0ndlgk3kcsv', '600102', 'Allowances', 'ALLOWANCES', '6001', 'Expense', 'Expense', true, NULL, 0, '2026-05-20T00:08:29.078+00:00'::timestamp, '2026-05-20T00:08:29.078+00:00'::timestamp),
  ('cmpdb03h9001qr0nd8l7axvrv', '600103', 'Overtime', 'OVERTIME', '6001', 'Expense', 'Expense', true, NULL, 0, '2026-05-20T00:08:29.085+00:00'::timestamp, '2026-05-20T00:08:29.085+00:00'::timestamp),
  ('cmpdb03he001rr0ndmpjfgle0', '600104', 'GOSI - Employer Contribution', 'GOSI - EMPLOYER', '6001', 'Expense', 'Expense', true, NULL, 0, '2026-05-20T00:08:29.090+00:00'::timestamp, '2026-05-20T00:08:29.090+00:00'::timestamp),
  ('cmpdb03hj001sr0ndekquab51', '6002', 'Rent Expenses', 'RENT EXPENSES', '60', 'Expense', 'Expense', true, NULL, 0, '2026-05-20T00:08:29.095+00:00'::timestamp, '2026-05-20T00:08:29.095+00:00'::timestamp),
  ('cmpdb03hp001tr0ndkgji9315', '600201', 'Office Rent', 'OFFICE RENT', '6002', 'Expense', 'Expense', true, NULL, 0, '2026-05-20T00:08:29.101+00:00'::timestamp, '2026-05-20T00:08:29.101+00:00'::timestamp),
  ('cmpdb03ht001ur0ndmgfwdslm', '600202', 'Warehouse Rent', 'WAREHOUSE RENT', '6002', 'Expense', 'Expense', true, NULL, 0, '2026-05-20T00:08:29.106+00:00'::timestamp, '2026-05-20T00:08:29.106+00:00'::timestamp),
  ('cmpdb03hy001vr0ndjawx0p5o', '6003', 'Utilities', 'UTILITIES', '60', 'Expense', 'Expense', true, NULL, 0, '2026-05-20T00:08:29.110+00:00'::timestamp, '2026-05-20T00:08:29.110+00:00'::timestamp),
  ('cmpdb03i3001wr0ndor784xsr', '600301', 'Electricity', 'ELECTRICITY', '6003', 'Expense', 'Expense', true, NULL, 0, '2026-05-20T00:08:29.115+00:00'::timestamp, '2026-05-20T00:08:29.115+00:00'::timestamp),
  ('cmpdb03i9001xr0ndezy33b3p', '600302', 'Water', 'WATER', '6003', 'Expense', 'Expense', true, NULL, 0, '2026-05-20T00:08:29.121+00:00'::timestamp, '2026-05-20T00:08:29.121+00:00'::timestamp),
  ('cmpdb03id001yr0ndykqtobv4', '600303', 'Internet and Telecom', 'INTERNET & TELECOM', '6003', 'Expense', 'Expense', true, NULL, 0, '2026-05-20T00:08:29.125+00:00'::timestamp, '2026-05-20T00:08:29.125+00:00'::timestamp),
  ('cmpdb03ij001zr0nd1lz1h7w2', '6004', 'General and Administrative', 'GENERAL & ADMIN', '60', 'Expense', 'Expense', true, NULL, 0, '2026-05-20T00:08:29.131+00:00'::timestamp, '2026-05-20T00:08:29.131+00:00'::timestamp),
  ('cmpdb03ip0020r0nd5zjj0lo5', '600401', 'Office Supplies', 'OFFICE SUPPLIES', '6004', 'Expense', 'Expense', true, NULL, 0, '2026-05-20T00:08:29.137+00:00'::timestamp, '2026-05-20T00:08:29.137+00:00'::timestamp),
  ('cmpdb03it0021r0ndi4ces4rp', '600402', 'Printing and Stationery', 'PRINTING & STATIONERY', '6004', 'Expense', 'Expense', true, NULL, 0, '2026-05-20T00:08:29.141+00:00'::timestamp, '2026-05-20T00:08:29.141+00:00'::timestamp),
  ('cmpdb03j00022r0ndv8ydxbkg', '600403', 'Travel and Transport', 'TRAVEL & TRANSPORT', '6004', 'Expense', 'Expense', true, NULL, 0, '2026-05-20T00:08:29.148+00:00'::timestamp, '2026-05-20T00:08:29.148+00:00'::timestamp),
  ('cmpdb03j60023r0nd8xnapilu', '600404', 'Meals and Entertainment', 'MEALS & ENTERTAINMENT', '6004', 'Expense', 'Expense', true, NULL, 0, '2026-05-20T00:08:29.154+00:00'::timestamp, '2026-05-20T00:08:29.154+00:00'::timestamp),
  ('cmpdb03jb0024r0ndxkiv3iel', '600405', 'Insurance', 'INSURANCE', '6004', 'Expense', 'Expense', true, NULL, 0, '2026-05-20T00:08:29.159+00:00'::timestamp, '2026-05-20T00:08:29.159+00:00'::timestamp),
  ('cmpdb03jk0025r0ndptmdrcs9', '600406', 'Legal and Professional Fees', 'LEGAL & PROFESSIONAL', '6004', 'Expense', 'Expense', true, NULL, 0, '2026-05-20T00:08:29.168+00:00'::timestamp, '2026-05-20T00:08:29.168+00:00'::timestamp),
  ('cmpdb03jq0026r0nddddxst12', '600407', 'Repairs and Maintenance', 'REPAIRS & MAINTENANCE', '6004', 'Expense', 'Expense', true, NULL, 0, '2026-05-20T00:08:29.174+00:00'::timestamp, '2026-05-20T00:08:29.174+00:00'::timestamp),
  ('cmpdb03ju0027r0ndysa5btzl', '600408', 'Depreciation Expense', 'DEPRECIATION', '6004', 'Expense', 'Expense', true, NULL, 0, '2026-05-20T00:08:29.178+00:00'::timestamp, '2026-05-20T00:08:29.178+00:00'::timestamp),
  ('cmpdb03k00028r0ndkrz5ah0o', '6005', 'Marketing and Sales', 'MARKETING & SALES', '60', 'Expense', 'Expense', true, NULL, 0, '2026-05-20T00:08:29.184+00:00'::timestamp, '2026-05-20T00:08:29.184+00:00'::timestamp),
  ('cmpdb03k40029r0ndg3h124zv', '600501', 'Advertising', 'ADVERTISING', '6005', 'Expense', 'Expense', true, NULL, 0, '2026-05-20T00:08:29.188+00:00'::timestamp, '2026-05-20T00:08:29.188+00:00'::timestamp),
  ('cmpdb03k9002ar0ndq5lzaiuh', '600502', 'Promotions', 'PROMOTIONS', '6005', 'Expense', 'Expense', true, NULL, 0, '2026-05-20T00:08:29.193+00:00'::timestamp, '2026-05-20T00:08:29.193+00:00'::timestamp),
  ('cmpdb03kf002br0ndxkacdk86', '6006', 'Finance Costs', 'FINANCE COSTS', '60', 'Expense', 'Expense', true, NULL, 0, '2026-05-20T00:08:29.199+00:00'::timestamp, '2026-05-20T00:08:29.199+00:00'::timestamp),
  ('cmpdb03kk002cr0ndp5iktcoy', '600601', 'Bank Charges', 'BANK CHARGES', '6006', 'Expense', 'Expense', true, NULL, 0, '2026-05-20T00:08:29.204+00:00'::timestamp, '2026-05-20T00:08:29.204+00:00'::timestamp),
  ('cmpdb03ko002dr0ndsagprh2o', '600602', 'Interest Expense', 'INTEREST EXPENSE', '6006', 'Expense', 'Expense', true, NULL, 0, '2026-05-20T00:08:29.208+00:00'::timestamp, '2026-05-20T00:08:29.208+00:00'::timestamp)
ON CONFLICT DO NOTHING;

INSERT INTO "TaxRate" ("id", "name", "rate", "type", "isDefault", "isActive", "createdAt") VALUES
  ('cmpdb03l6002er0nd152zybiw', 'VAT 15%', 15, 'VAT', true, true, '2026-05-20T00:08:29.226+00:00'::timestamp),
  ('cmpdb03l6002fr0ndhdw5x8p9', 'VAT 5%', 5, 'VAT', false, true, '2026-05-20T00:08:29.226+00:00'::timestamp),
  ('cmpdb03l6002gr0ndde4an5cs', 'Zero Rated', 0, 'VAT', false, true, '2026-05-20T00:08:29.226+00:00'::timestamp),
  ('cmpdb03l6002hr0nd8bvh9uxt', 'Exempt', 0, 'EXEMPT', false, true, '2026-05-20T00:08:29.226+00:00'::timestamp)
ON CONFLICT DO NOTHING;

INSERT INTO "Sequence" ("id", "type", "prefix", "nextNo") VALUES
  ('cmpdb03lf002ir0ndt22smjma', 'JOURNAL', 'JV-', 1),
  ('cmpdb03ll002jr0nd44dqwofb', 'INVOICE', 'INV-', 1),
  ('cmpdb03lq002kr0ndkjczqksc', 'BILL', 'BILL-', 1),
  ('cmpdb03lx002lr0nd1elqenql', 'EXPENSE', 'EXP-', 1),
  ('cmpdb03m3002mr0nd0wfbyft0', 'PAYMENT', 'PAY-', 1),
  ('cmpdb03m9002nr0nd6on51v47', 'EMPLOYEE', 'EMP-', 1),
  ('cmpdb03me002or0nddpi0rgri', 'PAYROLL', 'PRL-', 1),
  ('cmpdb03mj002pr0ndsoxizvcq', 'CUSTOMER', 'CUST-', 1),
  ('cmpdb03mo002qr0ndis9f16zq', 'VENDOR', 'VEND-', 1),
  ('cmpdb03mt002rr0nddi73u4tl', 'ITEM', 'ITEM-', 1),
  ('cmpdb03my002sr0ndc67myvja', 'CC', 'CC-', 1)
ON CONFLICT DO NOTHING;

INSERT INTO "CostCenter" ("id", "code", "name", "type", "description", "isActive", "createdAt", "updatedAt") VALUES
  ('cmpdb03n5002tr0ndfdn7o39d', 'CC-RYD', 'Riyadh Office', 'BRANCH', 'Riyadh Head Office', true, '2026-05-20T00:08:29.297+00:00'::timestamp, '2026-05-20T00:08:29.297+00:00'::timestamp),
  ('cmpdb03na002ur0ndx3qjhkzg', 'CC-DMM', 'Dammam Office', 'BRANCH', 'Dammam Branch Office', true, '2026-05-20T00:08:29.302+00:00'::timestamp, '2026-05-20T00:08:29.302+00:00'::timestamp),
  ('cmpdb03nf002vr0nd0u0q43yh', 'CC-PRJ', 'General Projects', 'PROJECT', 'General project cost center', true, '2026-05-20T00:08:29.307+00:00'::timestamp, '2026-05-20T00:08:29.307+00:00'::timestamp),
  ('cmpdb03nk002wr0ndtdv71o5f', 'CC-ADM', 'Administration', 'DEPARTMENT', 'Administrative department', true, '2026-05-20T00:08:29.312+00:00'::timestamp, '2026-05-20T00:08:29.312+00:00'::timestamp),
  ('cmpdb03nq002xr0nd9ci0r3b1', 'CC-OPS', 'Operations', 'DEPARTMENT', 'Operations department', true, '2026-05-20T00:08:29.318+00:00'::timestamp, '2026-05-20T00:08:29.318+00:00'::timestamp)
ON CONFLICT DO NOTHING;

-- Optional RLS baseline for Supabase Data API. Prisma/server code uses the database connection string
-- and is not restricted by these policies when it connects as the Prisma DB role.
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AppSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ChartOfAccount" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CostCenter" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "JournalEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "JournalLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Customer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Vendor" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Invoice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InvoiceLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Bill" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BillLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Expense" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ExpenseLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Payment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Employee" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PayrollEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PayrollLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InventoryItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TaxRate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Receipt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CompanySettings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Sequence" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_read_user_profile" ON "User"
  FOR SELECT TO authenticated USING ("authUserId" = auth.uid() OR EXISTS (SELECT 1 FROM "User" u WHERE u."authUserId" = auth.uid() AND u."role" = 'ADMIN'));
