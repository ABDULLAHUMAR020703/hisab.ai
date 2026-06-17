-- AlterTable
ALTER TABLE "ZatcaCredential" ADD COLUMN "productionCertificate" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Invoice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "invoiceNo" TEXT NOT NULL,
    "invoiceUUID" TEXT,
    "invoiceHash" TEXT,
    "previousInvoiceHash" TEXT,
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
    "zatcaStatus" TEXT NOT NULL DEFAULT 'DRAFT',
    "clearanceStatus" TEXT,
    "zatcaResponseCode" TEXT,
    "zatcaResponseMessage" TEXT,
    "zatcaRequestId" TEXT,
    "zatcaResponsePayload" TEXT,
    "clearedInvoicePayload" TEXT,
    "signedXml" TEXT,
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
INSERT INTO "new_Invoice" ("amountPaid", "balance", "clearanceStatus", "createdAt", "createdById", "currency", "customerId", "date", "dueDate", "id", "invoiceHash", "invoiceNo", "invoiceType", "invoiceUUID", "isRecurring", "issueTime", "nextDueDate", "notes", "previousInvoiceHash", "recurringDay", "status", "subtotal", "taxAmount", "terms", "total", "updatedAt", "zatcaStatus", "zatcaSubmissionDate") SELECT "amountPaid", "balance", "clearanceStatus", "createdAt", "createdById", "currency", "customerId", "date", "dueDate", "id", "invoiceHash", "invoiceNo", "invoiceType", "invoiceUUID", "isRecurring", "issueTime", "nextDueDate", "notes", "previousInvoiceHash", "recurringDay", "status", "subtotal", "taxAmount", "terms", "total", "updatedAt", COALESCE("zatcaStatus", 'DRAFT'), "zatcaSubmissionDate" FROM "Invoice";
DROP TABLE "Invoice";
ALTER TABLE "new_Invoice" RENAME TO "Invoice";
CREATE UNIQUE INDEX "Invoice_invoiceNo_key" ON "Invoice"("invoiceNo");
CREATE UNIQUE INDEX "Invoice_invoiceUUID_key" ON "Invoice"("invoiceUUID");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
