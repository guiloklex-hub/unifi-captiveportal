-- Fase 5: webhooks, API pública com chaves e relatórios por e-mail.

ALTER TABLE "SystemSettings" ADD COLUMN "reportFrequency" TEXT NOT NULL DEFAULT 'off';
ALTER TABLE "SystemSettings" ADD COLUMN "reportRecipients" TEXT;

CREATE TABLE "Webhook" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secretEnc" TEXT NOT NULL,
    "events" TEXT NOT NULL,
    "includePii" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastDeliveryAt" DATETIME,
    "lastStatus" INTEGER,
    "lastError" TEXT
);

CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "scopes" TEXT NOT NULL,
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" DATETIME,
    "revokedAt" DATETIME
);
CREATE UNIQUE INDEX "ApiKey_prefix_key" ON "ApiKey"("prefix");
