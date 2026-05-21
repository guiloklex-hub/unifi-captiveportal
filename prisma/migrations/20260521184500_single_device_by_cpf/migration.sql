-- Bloqueio de 1 dispositivo por CPF (flag-ativável).
-- Ver docs do feature no README e no fluxo /api/portal/authorize.

-- Marca explícita de "sessão encerrada antes do tempo" (override do admin).
-- Mantemos NULL = sessão viva; data preenchida = revogada. Não suja
-- durationMin nem authorizedAt, então auditoria/relatórios seguem corretos.
ALTER TABLE "GuestRegistration" ADD COLUMN "revokedAt" DATETIME;

-- Toggle global do recurso. Default false preserva o comportamento atual ao
-- aplicar a migration sobre bases existentes.
ALTER TABLE "SystemSettings" ADD COLUMN "singleDeviceByCpf" BOOLEAN NOT NULL DEFAULT false;

-- Índice composto: torna barata a checagem
--   WHERE cpf = ? AND revokedAt IS NULL AND authorizedAt > ?
-- feita por src/lib/cpfLock.ts a cada autorização quando a flag está ativa.
CREATE INDEX "GuestRegistration_cpf_revokedAt_authorizedAt_idx"
  ON "GuestRegistration" ("cpf", "revokedAt", "authorizedAt");
