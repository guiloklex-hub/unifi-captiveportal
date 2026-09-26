-- Fase 2a: formas de acesso configuráveis, marca por site e vouchers em lote.
-- ADD COLUMN (em vez de recriar tabelas) para migrar rápido bases grandes.

-- GuestRegistration
ALTER TABLE "GuestRegistration" ADD COLUMN "documentType" TEXT;
ALTER TABLE "GuestRegistration" ADD COLUMN "document" TEXT;
ALTER TABLE "GuestRegistration" ADD COLUMN "visitorKey" TEXT NOT NULL DEFAULT '';
ALTER TABLE "GuestRegistration" ADD COLUMN "authMethod" TEXT NOT NULL DEFAULT 'form';

-- Backfill: registros antigos sempre tinham CPF; os com token vieram pelo fluxo de token.
UPDATE "GuestRegistration" SET "visitorKey" = "cpf" WHERE "visitorKey" = '';
UPDATE "GuestRegistration" SET "authMethod" = 'token' WHERE "tokenId" IS NOT NULL;

CREATE INDEX "GuestRegistration_visitorKey_idx" ON "GuestRegistration"("visitorKey");

-- AccessToken
ALTER TABLE "AccessToken" ADD COLUMN "batchId" TEXT;
CREATE INDEX "AccessToken_batchId_idx" ON "AccessToken"("batchId");

-- SystemSettings
ALTER TABLE "SystemSettings" ADD COLUMN "defaultDurationMin" INTEGER;
ALTER TABLE "SystemSettings" ADD COLUMN "defaultDownKbps" INTEGER;
ALTER TABLE "SystemSettings" ADD COLUMN "defaultUpKbps" INTEGER;
ALTER TABLE "SystemSettings" ADD COLUMN "defaultQuotaMB" INTEGER;
ALTER TABLE "SystemSettings" ADD COLUMN "fieldName" TEXT NOT NULL DEFAULT 'required';
ALTER TABLE "SystemSettings" ADD COLUMN "fieldEmail" TEXT NOT NULL DEFAULT 'required';
ALTER TABLE "SystemSettings" ADD COLUMN "fieldPhone" TEXT NOT NULL DEFAULT 'required';
ALTER TABLE "SystemSettings" ADD COLUMN "fieldDocument" TEXT NOT NULL DEFAULT 'required';
ALTER TABLE "SystemSettings" ADD COLUMN "allowForeignDocument" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SystemSettings" ADD COLUMN "rememberDeviceDays" INTEGER NOT NULL DEFAULT 0;

-- SiteBranding
CREATE TABLE "SiteBranding" (
    "site" TEXT NOT NULL PRIMARY KEY,
    "brandName" TEXT,
    "logoUrl" TEXT,
    "backgroundUrl" TEXT,
    "primaryColor" TEXT,
    "termsOfUse" TEXT,
    "updatedAt" DATETIME NOT NULL
);
