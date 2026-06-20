-- ZATCA onboarding v2: company link, EGS tracking, encrypted cert fields, onboarding requests

ALTER TABLE "CompanySettings" ADD COLUMN "zatcaConnected" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CompanySettings" ADD COLUMN "zatcaConnectedAt" DATETIME;
ALTER TABLE "CompanySettings" ADD COLUMN "zatcaDeviceIdentifier" TEXT;
ALTER TABLE "CompanySettings" ADD COLUMN "zatcaEgsSerialNumber" TEXT;

ALTER TABLE "ZatcaCredential" ADD COLUMN "companySettingsId" TEXT;
ALTER TABLE "ZatcaCredential" ADD COLUMN "egsUnitId" TEXT;
ALTER TABLE "ZatcaCredential" ADD COLUMN "csrEnc" TEXT;
ALTER TABLE "ZatcaCredential" ADD COLUMN "certificateEnc" TEXT;
ALTER TABLE "ZatcaCredential" ADD COLUMN "binarySecurityTokenEnc" TEXT;
ALTER TABLE "ZatcaCredential" ADD COLUMN "requestId" TEXT;
ALTER TABLE "ZatcaCredential" ADD COLUMN "productionCertificateEnc" TEXT;

CREATE TABLE "ZatcaOnboardingRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companySettingsId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "egsUnitId" TEXT NOT NULL,
    "requestId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ZatcaOnboardingRequest_companySettingsId_fkey" FOREIGN KEY ("companySettingsId") REFERENCES "CompanySettings" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ZatcaOnboardingRequest_companySettingsId_environment_idx" ON "ZatcaOnboardingRequest"("companySettingsId", "environment");
