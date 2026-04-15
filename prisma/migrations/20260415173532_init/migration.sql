-- CreateTable
CREATE TABLE "GuestRegistration" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "cpf" TEXT NOT NULL,
    "macAddress" TEXT NOT NULL,
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
    "lastSeenAt" DATETIME
);

-- CreateIndex
CREATE INDEX "GuestRegistration_cpf_idx" ON "GuestRegistration"("cpf");

-- CreateIndex
CREATE INDEX "GuestRegistration_macAddress_idx" ON "GuestRegistration"("macAddress");

-- CreateIndex
CREATE INDEX "GuestRegistration_authorizedAt_idx" ON "GuestRegistration"("authorizedAt");
