-- Fase 2b: verificação por código (e-mail/SMS) e login social.

ALTER TABLE "SystemSettings" ADD COLUMN "verificationMode" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "SystemSettings" ADD COLUMN "otpPreAuthMinutes" INTEGER NOT NULL DEFAULT 10;
ALTER TABLE "SystemSettings" ADD COLUMN "socialGoogle" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SystemSettings" ADD COLUMN "socialMicrosoft" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "OtpChallenge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mac" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "preAuth" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "verifiedAt" DATETIME
);
CREATE INDEX "OtpChallenge_mac_createdAt_idx" ON "OtpChallenge"("mac", "createdAt");

CREATE TABLE "OAuthLogin" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "codeVerifier" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "context" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "ticket" TEXT,
    "usedAt" DATETIME
);
CREATE UNIQUE INDEX "OAuthLogin_ticket_key" ON "OAuthLogin"("ticket");
CREATE INDEX "OAuthLogin_expiresAt_idx" ON "OAuthLogin"("expiresAt");
