import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIN_RETENTION_DAYS = 7;
const DEFAULT_RETENTION_DAYS = 180;

/**
 * Limpeza diária: apaga GuestRegistration mais antigos que
 * GUEST_RETENTION_DAYS (default 180, mínimo 7). Autenticação herdada
 * do middleware (cookie de admin OU Bearer CRON_SECRET).
 *
 * Cron típico (uma vez por dia, 03:30):
 *   30 3 * * * curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" \
 *     http://127.0.0.1/api/admin/cleanup
 */
export async function POST() {
  const envRaw = parseInt(process.env.GUEST_RETENTION_DAYS ?? "", 10);
  const retention = Number.isFinite(envRaw) && envRaw >= MIN_RETENTION_DAYS
    ? envRaw
    : DEFAULT_RETENTION_DAYS;

  const cutoff = new Date(Date.now() - retention * 24 * 60 * 60 * 1000);

  const result = await prisma.guestRegistration.deleteMany({
    where: { authorizedAt: { lt: cutoff } },
  });

  logger.info(
    { retention, cutoff: cutoff.toISOString(), deleted: result.count },
    "cleanup: GuestRegistration purge",
  );

  return NextResponse.json({
    ok: true,
    retentionDays: retention,
    cutoff: cutoff.toISOString(),
    deleted: result.count,
  });
}
