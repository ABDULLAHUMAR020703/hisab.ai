-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN "zatcaFailureCode" TEXT;

-- CreateTable
CREATE TABLE "ZatcaAuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "action" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "message" TEXT,
    "userId" TEXT,
    "userName" TEXT,
    "companyName" TEXT,
    "invoiceId" TEXT,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ZatcaSandboxTestRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scenario" TEXT NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "steps" TEXT NOT NULL,
    "error" TEXT,
    "durationMs" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
