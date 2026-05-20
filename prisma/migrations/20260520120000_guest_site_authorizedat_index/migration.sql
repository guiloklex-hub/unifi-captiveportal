-- Índice composto para acelerar queries por site + janela temporal,
-- usadas em /api/admin/logs?from=&to=&site= e nos cron de reconcile/cleanup.
CREATE INDEX "GuestRegistration_site_authorizedAt_idx"
  ON "GuestRegistration" ("site", "authorizedAt");
