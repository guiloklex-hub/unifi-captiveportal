-- Adiciona authDate (YYYY-MM-DD) e UNIQUE composto (macAddress, authDate) para idempotência diária.
-- Backfill a partir de authorizedAt e deduplicação preservando o registro mais recente por (MAC, dia).

-- 1) Adiciona coluna com default temporário
ALTER TABLE "GuestRegistration" ADD COLUMN "authDate" TEXT NOT NULL DEFAULT '1970-01-01';

-- 2) Backfill: extrai YYYY-MM-DD de authorizedAt
UPDATE "GuestRegistration" SET "authDate" = substr("authorizedAt", 1, 10);

-- 3) Deduplica: mantém apenas o registro mais recente (maior id) por (macAddress, authDate)
DELETE FROM "GuestRegistration"
WHERE "id" NOT IN (
  SELECT MAX("id") FROM "GuestRegistration" GROUP BY "macAddress", "authDate"
);

-- 4) Cria índice UNIQUE composto
CREATE UNIQUE INDEX "GuestRegistration_macAddress_authDate_key"
  ON "GuestRegistration"("macAddress", "authDate");
