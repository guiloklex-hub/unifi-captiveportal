-- Fase 4 (LGPD): versão dos termos aceitos, consentimento de marketing e anonimização.

ALTER TABLE "GuestRegistration" ADD COLUMN "termsHash" TEXT;
ALTER TABLE "GuestRegistration" ADD COLUMN "marketingConsent" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "GuestRegistration" ADD COLUMN "anonymizedAt" DATETIME;
CREATE INDEX "GuestRegistration_anonymizedAt_authorizedAt_idx" ON "GuestRegistration"("anonymizedAt", "authorizedAt");

ALTER TABLE "SystemSettings" ADD COLUMN "marketingConsentMode" TEXT NOT NULL DEFAULT 'off';
ALTER TABLE "SystemSettings" ADD COLUMN "marketingConsentText" TEXT;

CREATE TABLE "TermsVersion" (
    "hash" TEXT NOT NULL PRIMARY KEY,
    "text" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
