-- CreateTable
CREATE TABLE "AppSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Bill" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "billNo" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "dueDate" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "subtotal" REAL NOT NULL DEFAULT 0,
    "taxAmount" REAL NOT NULL DEFAULT 0,
    "total" REAL NOT NULL DEFAULT 0,
    "amountPaid" REAL NOT NULL DEFAULT 0,
    "balance" REAL NOT NULL DEFAULT 0,
    "notes" TEXT,
    "reference" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BillLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "billId" TEXT NOT NULL,
    "accountId" TEXT,
    "costCenterId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" REAL NOT NULL DEFAULT 1,
    "unitPrice" REAL NOT NULL DEFAULT 0,
    "taxRate" REAL NOT NULL DEFAULT 15,
    "amount" REAL NOT NULL DEFAULT 0,
    FOREIGN KEY ("costCenterId") REFERENCES "CostCenter" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    FOREIGN KEY ("accountId") REFERENCES "ChartOfAccount" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    FOREIGN KEY ("billId") REFERENCES "Bill" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ChartOfAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountNo" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentNo" TEXT,
    "accountType" TEXT NOT NULL,
    "subType" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "balance" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CompanySettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CostCenter" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'PROJECT',
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerNo" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "city" TEXT,
    "country" TEXT,
    "taxId" TEXT,
    "creditLimit" REAL NOT NULL DEFAULT 0,
    "paymentTerms" INTEGER NOT NULL DEFAULT 30,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employeeNo" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "department" TEXT,
    "position" TEXT,
    "joiningDate" DATETIME NOT NULL,
    "salary" REAL NOT NULL DEFAULT 0,
    "salaryType" TEXT NOT NULL DEFAULT 'MONTHLY',
    "bankAccount" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "expenseNo" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "total" REAL NOT NULL DEFAULT 0,
    "taxAmount" REAL NOT NULL DEFAULT 0,
    "receiptId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    FOREIGN KEY ("receiptId") REFERENCES "Receipt" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExpenseLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "expenseId" TEXT NOT NULL,
    "accountId" TEXT,
    "description" TEXT NOT NULL,
    "amount" REAL NOT NULL DEFAULT 0,
    "taxRate" REAL NOT NULL DEFAULT 0,
    FOREIGN KEY ("accountId") REFERENCES "ChartOfAccount" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    FOREIGN KEY ("expenseId") REFERENCES "Expense" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InventoryItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "itemCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'PCS',
    "costPrice" REAL NOT NULL DEFAULT 0,
    "salePrice" REAL NOT NULL DEFAULT 0,
    "quantity" REAL NOT NULL DEFAULT 0,
    "minQuantity" REAL NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "invoiceNo" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "dueDate" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "subtotal" REAL NOT NULL DEFAULT 0,
    "taxAmount" REAL NOT NULL DEFAULT 0,
    "total" REAL NOT NULL DEFAULT 0,
    "amountPaid" REAL NOT NULL DEFAULT 0,
    "balance" REAL NOT NULL DEFAULT 0,
    "notes" TEXT,
    "terms" TEXT,
    "isRecurring" BOOLEAN NOT NULL DEFAULT false,
    "recurringDay" INTEGER,
    "nextDueDate" DATETIME,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InvoiceLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "invoiceId" TEXT NOT NULL,
    "accountId" TEXT,
    "costCenterId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" REAL NOT NULL DEFAULT 1,
    "unitPrice" REAL NOT NULL DEFAULT 0,
    "taxRate" REAL NOT NULL DEFAULT 15,
    "amount" REAL NOT NULL DEFAULT 0,
    FOREIGN KEY ("costCenterId") REFERENCES "CostCenter" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    FOREIGN KEY ("accountId") REFERENCES "ChartOfAccount" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entryNo" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "description" TEXT NOT NULL,
    "reference" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "totalDebit" REAL NOT NULL DEFAULT 0,
    "totalCredit" REAL NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "JournalLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "journalId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "costCenterId" TEXT,
    "description" TEXT,
    "debit" REAL NOT NULL DEFAULT 0,
    "credit" REAL NOT NULL DEFAULT 0,
    "taxRate" REAL NOT NULL DEFAULT 0,
    FOREIGN KEY ("costCenterId") REFERENCES "CostCenter" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    FOREIGN KEY ("accountId") REFERENCES "ChartOfAccount" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    FOREIGN KEY ("journalId") REFERENCES "JournalEntry" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "paymentNo" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "amount" REAL NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'BANK_TRANSFER',
    "reference" TEXT,
    "notes" TEXT,
    "invoiceId" TEXT,
    "billId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY ("billId") REFERENCES "Bill" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PayrollEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "payrollNo" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "periodStart" DATETIME NOT NULL,
    "periodEnd" DATETIME NOT NULL,
    "basicSalary" REAL NOT NULL DEFAULT 0,
    "allowances" REAL NOT NULL DEFAULT 0,
    "deductions" REAL NOT NULL DEFAULT 0,
    "taxAmount" REAL NOT NULL DEFAULT 0,
    "netSalary" REAL NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "paidAt" DATETIME,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PayrollLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "payrollId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    FOREIGN KEY ("payrollId") REFERENCES "PayrollEntry" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Receipt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "vendor" TEXT,
    "amount" REAL,
    "date" DATETIME,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'UNPROCESSED',
    "uploadedById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY ("uploadedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Sequence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "nextNo" INTEGER NOT NULL DEFAULT 1
);

-- CreateTable
CREATE TABLE "TaxRate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "rate" REAL NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'VAT',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "password" TEXT,
    "role" TEXT NOT NULL DEFAULT 'ACCOUNTANT',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Vendor" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "AppSession_token_key" ON "AppSession"("token" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Bill_billNo_key" ON "Bill"("billNo" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "ChartOfAccount_accountNo_key" ON "ChartOfAccount"("accountNo" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "CostCenter_code_key" ON "CostCenter"("code" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Customer_customerNo_key" ON "Customer"("customerNo" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Employee_employeeNo_key" ON "Employee"("employeeNo" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Expense_expenseNo_key" ON "Expense"("expenseNo" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItem_itemCode_key" ON "InventoryItem"("itemCode" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_invoiceNo_key" ON "Invoice"("invoiceNo" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_entryNo_key" ON "JournalEntry"("entryNo" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Payment_paymentNo_key" ON "Payment"("paymentNo" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "PayrollEntry_payrollNo_key" ON "PayrollEntry"("payrollNo" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Sequence_type_key" ON "Sequence"("type" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Vendor_vendorNo_key" ON "Vendor"("vendorNo" ASC);
