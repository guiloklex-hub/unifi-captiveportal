-- CreateTable
CREATE TABLE "AccessToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "durationMin" INTEGER NOT NULL,
    "downKbps" INTEGER,
    "upKbps" INTEGER,
    "bytesQuotaMB" INTEGER,
    "maxUses" INTEGER NOT NULL,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" DATETIME NOT NULL,
    "revokedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_GuestRegistration" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "cpf" TEXT NOT NULL,
    "macAddress" TEXT NOT NULL,
    "authDate" TEXT NOT NULL DEFAULT '1970-01-01',
    "apMac" TEXT,
    "ssid" TEXT,
    "site" TEXT,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "authorizedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "durationMin" INTEGER NOT NULL,
    "downKbps" INTEGER,
    "upKbps" INTEGER,
    "bytesTx" BIGINT,
    "bytesRx" BIGINT,
    "lastSeenAt" DATETIME,
    "tokenId" TEXT,
    CONSTRAINT "GuestRegistration_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "AccessToken" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_GuestRegistration" ("apMac", "authDate", "authorizedAt", "bytesRx", "bytesTx", "cpf", "downKbps", "durationMin", "email", "fullName", "id", "ipAddress", "lastSeenAt", "macAddress", "phone", "site", "ssid", "upKbps", "userAgent") SELECT "apMac", "authDate", "authorizedAt", "bytesRx", "bytesTx", "cpf", "downKbps", "durationMin", "email", "fullName", "id", "ipAddress", "lastSeenAt", "macAddress", "phone", "site", "ssid", "upKbps", "userAgent" FROM "GuestRegistration";
DROP TABLE "GuestRegistration";
ALTER TABLE "new_GuestRegistration" RENAME TO "GuestRegistration";
CREATE INDEX "GuestRegistration_cpf_idx" ON "GuestRegistration"("cpf");
CREATE INDEX "GuestRegistration_macAddress_idx" ON "GuestRegistration"("macAddress");
CREATE INDEX "GuestRegistration_authorizedAt_idx" ON "GuestRegistration"("authorizedAt");
CREATE INDEX "GuestRegistration_tokenId_idx" ON "GuestRegistration"("tokenId");
CREATE UNIQUE INDEX "GuestRegistration_macAddress_authDate_key" ON "GuestRegistration"("macAddress", "authDate");
CREATE TABLE "new_SystemSettings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'config',
    "brandName" TEXT NOT NULL DEFAULT 'UniFi Portal',
    "logoUrl" TEXT,
    "backgroundUrl" TEXT,
    "primaryColor" TEXT NOT NULL DEFAULT '#171717',
    "termsOfUse" TEXT NOT NULL DEFAULT 'Ao conectar, você aceita os termos de uso e a política de privacidade.',
    "requireToken" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_SystemSettings" ("backgroundUrl", "brandName", "id", "logoUrl", "primaryColor", "termsOfUse", "updatedAt") SELECT "backgroundUrl", "brandName", "id", "logoUrl", "primaryColor", "termsOfUse", "updatedAt" FROM "SystemSettings";
DROP TABLE "SystemSettings";
ALTER TABLE "new_SystemSettings" RENAME TO "SystemSettings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "AccessToken_code_key" ON "AccessToken"("code");

-- CreateIndex
CREATE INDEX "AccessToken_code_idx" ON "AccessToken"("code");

-- CreateIndex
CREATE INDEX "AccessToken_expiresAt_idx" ON "AccessToken"("expiresAt");
