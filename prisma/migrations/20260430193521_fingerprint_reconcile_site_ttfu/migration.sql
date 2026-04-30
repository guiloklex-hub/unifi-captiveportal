-- AlterTable
ALTER TABLE "GuestRegistration" ADD COLUMN "fingerprint" TEXT;
ALTER TABLE "GuestRegistration" ADD COLUMN "reconciledAt" DATETIME;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AccessToken" (
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
    "site" TEXT NOT NULL DEFAULT 'default',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firstUsedAt" DATETIME
);
INSERT INTO "new_AccessToken" ("bytesQuotaMB", "code", "createdAt", "description", "downKbps", "durationMin", "expiresAt", "id", "maxUses", "revokedAt", "upKbps", "usedCount") SELECT "bytesQuotaMB", "code", "createdAt", "description", "downKbps", "durationMin", "expiresAt", "id", "maxUses", "revokedAt", "upKbps", "usedCount" FROM "AccessToken";
DROP TABLE "AccessToken";
ALTER TABLE "new_AccessToken" RENAME TO "AccessToken";
CREATE UNIQUE INDEX "AccessToken_code_key" ON "AccessToken"("code");
CREATE INDEX "AccessToken_code_idx" ON "AccessToken"("code");
CREATE INDEX "AccessToken_expiresAt_idx" ON "AccessToken"("expiresAt");
CREATE INDEX "AccessToken_site_idx" ON "AccessToken"("site");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "GuestRegistration_fingerprint_idx" ON "GuestRegistration"("fingerprint");
