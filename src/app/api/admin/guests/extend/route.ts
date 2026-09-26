import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authorizeGuest } from "@/lib/unifi";
import { logger } from "@/lib/logger";
import { audit } from "@/lib/admin/audit";

export const runtime = "nodejs";

const schema = z.object({
  mac: z.string().trim().regex(/^[0-9a-f]{2}([:-]?[0-9a-f]{2}){5}$/i, "MAC inválido"),
  site: z.string().trim().regex(/^[A-Za-z0-9_-]{1,64}$/).optional().nullable(),
  minutes: z.coerce.number().int().min(1).max(525_600),
});

/**
 * Estende a sessão de um guest conectado: reautoriza na UniFi por mais N
 * minutos (a partir de agora), mantendo banda/cota da sessão atual.
 */
export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos", issues: z.flattenError(parsed.error) }, { status: 400 });
  }
  const mac = parsed.data.mac.toLowerCase().replace(/-/g, ":");
  const { minutes, site } = parsed.data;

  const reg = await prisma.guestRegistration.findFirst({ where: { macAddress: mac }, orderBy: { authorizedAt: "desc" } });
  try {
    await authorizeGuest({
      mac,
      minutes,
      downKbps: reg?.downKbps ?? undefined,
      upKbps: reg?.upKbps ?? undefined,
      bytesQuotaMB: reg?.bytesQuotaMB ?? undefined,
      site: site ?? reg?.site ?? null,
    });
  } catch (err) {
    logger.warn({ mac, err: (err as Error).message }, "extend: UniFi authorize failed");
    return NextResponse.json({ error: "Não foi possível estender na controladora UniFi." }, { status: 502 });
  }

  if (reg) {
    // Mantém authorizedAt (histórico) e ajusta a duração para terminar em agora + N.
    const elapsedMin = Math.ceil((Date.now() - reg.authorizedAt.getTime()) / 60_000);
    await prisma.guestRegistration.update({ where: { id: reg.id }, data: { durationMin: elapsedMin + minutes } });
  }
  await audit(req, "guest.extend", mac, { minutes, site });
  return NextResponse.json({ ok: true });
}
