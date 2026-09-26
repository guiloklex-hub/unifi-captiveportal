-- CreateTable
CREATE TABLE "UniFiConnection" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "url" TEXT NOT NULL,
    "site" TEXT NOT NULL DEFAULT 'default',
    "authMode" TEXT NOT NULL DEFAULT 'auto',
    "username" TEXT,
    "passwordEnc" TEXT,
    "apiKeyEnc" TEXT,
    "insecureTls" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL
);

