import { NextRequest, NextResponse } from "next/server";
import { audit } from "@/lib/admin/audit";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { anonymizeRegistrations, piiRetentionDays } from "@/lib/privacy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIN_RETENTION_DAYS = 7;
// Marco Civil da Internet (Lei 12.965/2014, art. 13): registros de conexão
// devem ser guardados por 1 ano. Default alinhado a isso.
const DEFAULT_RETENTION_DAYS = 365;

/**
 * Limpeza diária: apaga GuestRegistration mais antigos que
 * GUEST_RETENTION_DAYS (default 365, mínimo 7). Autenticação herdada
 * do middleware (cookie de admin OU Bearer CRON_SECRET).
 *
 * Cron típico (uma vez por dia, 03:30):
 *   30 3 * * * curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" \
 *     http://127.0.0.1/api/admin/cleanup
 */
export async function POST(req: NextRequest) {
  const envRaw = parseInt(process.env.GUEST_RETENTION_DAYS ?? "", 10);
  const retention = Number.isFinite(envRaw) && envRaw >= MIN_RETENTION_DAYS
    ? envRaw
    : DEFAULT_RETENTION_DAYS;

  const cutoff = new Date(Date.now() - retention * 24 * 60 * 60 * 1000);

  const result = await prisma.guestRegistration.deleteMany({
    where: { authorizedAt: { lt: cutoff } },
  });

  // LGPD: dados pessoais podem ter retenção menor que o registro de conexão.
  // Após PII_RETENTION_DAYS o cadastro é anonimizado (MAC/IP/horários ficam).
  const piiDays = piiRetentionDays();
  const anonymized =
    piiDays > 0 && piiDays < retention
      ? await anonymizeRegistrations({ authorizedAt: { lt: new Date(Date.now() - piiDays * 24 * 60 * 60 * 1000) } })
      : 0;

  // Códigos de verificação e logins sociais: dados transitórios (24 h bastam).
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [otp, oauth] = await Promise.all([
    prisma.otpChallenge.deleteMany({ where: { createdAt: { lt: dayAgo } } }),
    prisma.oAuthLogin.deleteMany({ where: { createdAt: { lt: dayAgo } } }),
  ]);

  logger.info(
    { retention, cutoff: cutoff.toISOString(), deleted: result.count, anonymized, otp: otp.count, oauth: oauth.count },
    "cleanup: GuestRegistration purge",
  );

  await audit(req, "cleanup", null, { retention, deleted: result.count, piiDays, anonymized });
  return NextResponse.json({
    ok: true,
    retentionDays: retention,
    cutoff: cutoff.toISOString(),
    deleted: result.count,
    piiRetentionDays: piiDays,
    anonymized,
    deletedOtpChallenges: otp.count,
    deletedOAuthLogins: oauth.count,
  });
}
