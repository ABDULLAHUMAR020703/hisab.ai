-- CreateTable
CREATE TABLE "ZatcaCredential" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "environment" TEXT NOT NULL,
    "csr" TEXT,
    "privateKeyEnc" TEXT,
    "certificate" TEXT,
    "secretEnc" TEXT,
    "complianceCsid" TEXT,
    "productionCsid" TEXT,
    "onboardingStatus" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "lastError" TEXT,
    "onboardedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "ZatcaCredential_environment_key" ON "ZatcaCredential"("environment");
