import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { unauthorizeGuest } from "@/lib/unifi";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

const MAC_RE = /^[0-9a-f]{2}([:-]?[0-9a-f]{2}){5}$/i;

/**
 * Desconecta um guest na UniFi e marca a sessão como revogada no banco
 * (libera o bloqueio de CPF e mantém o histórico de revogação manual).
 * Aceita `site` para operar no site correto em instalações multi-site.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const mac = typeof body.mac === "string" ? body.mac.trim().toLowerCase() : "";
  const site = typeof body.site === "string" && body.site.trim() ? body.site.trim() : null;
  if (!MAC_RE.test(mac)) return NextResponse.json({ error: "MAC inválido" }, { status: 400 });

  try {
    await unauthorizeGuest(mac, site);
  } catch (err) {
    logger.warn({ mac, site, err: (err as Error).message }, "admin revoke failed on UniFi");
    return NextResponse.json(
      { error: "Não foi possível desconectar na controladora UniFi." },
      { status: 502 },
    );
  }

  await prisma.guestRegistration
    .updateMany({ where: { macAddress: mac, revokedAt: null }, data: { revokedAt: new Date() } })
    .catch((err) => logger.warn({ mac, err: (err as Error).message }, "revoke: DB update failed"));

  logger.info({ mac, site }, "guest revoked by admin");
  return NextResponse.json({ ok: true });
}
