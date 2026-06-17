-- AlterTable
ALTER TABLE "Customer" ADD COLUMN "buildingNumber" TEXT;
ALTER TABLE "Customer" ADD COLUMN "district" TEXT;
ALTER TABLE "Customer" ADD COLUMN "postalCode" TEXT;
ALTER TABLE "Customer" ADD COLUMN "streetAddress" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CompanySettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyName" TEXT NOT NULL DEFAULT 'NETKOM COMPANY FOR COMMUNICATION',
    "legalName" TEXT,
    "taxId" TEXT,
    "commercialRegistration" TEXT,
    "address" TEXT,
    "streetAddress" TEXT,
    "buildingNumber" TEXT,
    "district" TEXT,
    "city" TEXT,
    "postalCode" TEXT,
    "country" TEXT NOT NULL DEFAULT 'Saudi Arabia',
    "phone" TEXT,
    "email" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'SAR',
    "fiscalYearStart" TEXT NOT NULL DEFAULT '01-01',
    "zatcaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "zatcaEnvironment" TEXT NOT NULL DEFAULT 'SANDBOX',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_CompanySettings" ("address", "city", "companyName", "country", "createdAt", "currency", "email", "fiscalYearStart", "id", "legalName", "phone", "taxId", "updatedAt", "zatcaEnabled") SELECT "address", "city", "companyName", "country", "createdAt", "currency", "email", "fiscalYearStart", "id", "legalName", "phone", "taxId", "updatedAt", "zatcaEnabled" FROM "CompanySettings";
DROP TABLE "CompanySettings";
ALTER TABLE "new_CompanySettings" RENAME TO "CompanySettings";
CREATE TABLE "new_Invoice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "invoiceNo" TEXT NOT NULL,
    "invoiceUUID" TEXT,
    "invoiceHash" TEXT,
    "invoiceType" TEXT NOT NULL DEFAULT 'STANDARD',
    "customerId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "issueTime" TEXT,
    "dueDate" DATETIME NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'SAR',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "subtotal" REAL NOT NULL DEFAULT 0,
    "taxAmount" REAL NOT NULL DEFAULT 0,
    "total" REAL NOT NULL DEFAULT 0,
    "amountPaid" REAL NOT NULL DEFAULT 0,
    "balance" REAL NOT NULL DEFAULT 0,
    "zatcaStatus" TEXT,
    "clearanceStatus" TEXT,
    "zatcaSubmissionDate" DATETIME,
    "notes" TEXT,
    "terms" TEXT,
    "isRecurring" BOOLEAN NOT NULL DEFAULT false,
    "recurringDay" INTEGER,
    "nextDueDate" DATETIME,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Invoice_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Invoice" ("amountPaid", "balance", "createdAt", "createdById", "customerId", "date", "dueDate", "id", "invoiceNo", "isRecurring", "nextDueDate", "notes", "recurringDay", "status", "subtotal", "taxAmount", "terms", "total", "updatedAt") SELECT "amountPaid", "balance", "createdAt", "createdById", "customerId", "date", "dueDate", "id", "invoiceNo", "isRecurring", "nextDueDate", "notes", "recurringDay", "status", "subtotal", "taxAmount", "terms", "total", "updatedAt" FROM "Invoice";
DROP TABLE "Invoice";
ALTER TABLE "new_Invoice" RENAME TO "Invoice";
CREATE UNIQUE INDEX "Invoice_invoiceNo_key" ON "Invoice"("invoiceNo");
CREATE UNIQUE INDEX "Invoice_invoiceUUID_key" ON "Invoice"("invoiceUUID");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
