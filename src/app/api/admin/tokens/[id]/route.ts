import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { deriveStatus } from "@/lib/tokens";
import { extendTokenSchema } from "@/lib/tokenValidators";
import { unauthorizeGuest } from "@/lib/unifi";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

async function disconnectActiveGuests(tokenId: string): Promise<{ attempted: number; failed: number }> {
  // Desconecta na UniFi todos os guests autorizados via este token cujo
  // tempo nominal de sessão ainda não expirou. Falhas são logadas mas
  // não impedem a revogação do token no DB.
  const now = new Date();
  const candidates = await prisma.guestRegistration.findMany({
    where: { tokenId },
    select: { macAddress: true, site: true, authorizedAt: true, durationMin: true },
  });
  const stillActive = candidates.filter((g) => {
    const endsAt = g.authorizedAt.getTime() + g.durationMin * 60_000;
    return endsAt > now.getTime();
  });

  let failed = 0;
  for (const g of stillActive) {
    try {
      await unauthorizeGuest(g.macAddress, g.site);
    } catch (err) {
      failed += 1;
      logger.warn(
        { mac: g.macAddress, site: g.site, err: (err as Error).message },
        "Failed to unauthorize guest during token revocation cascade",
      );
    }
  }
  return { attempted: stillActive.length, failed };
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  let body: { action?: string; cascade?: boolean; expiresAt?: string; addUses?: number } = {};
  try {
    body = await req.json();
  } catch {
    // ignora — default action é "revoke"
  }

  const action = body.action ?? "revoke";

  const existing = await prisma.accessToken.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Token não encontrado" }, { status: 404 });
  }

  if (action === "revoke") {
    let disconnect = { attempted: 0, failed: 0 };
    if (body.cascade) {
      disconnect = await disconnectActiveGuests(id);
    }

    if (existing.revokedAt) {
      return NextResponse.json({
        ...existing,
        status: deriveStatus(existing),
        disconnect,
      });
    }

    const updated = await prisma.accessToken.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
    return NextResponse.json({
      ...updated,
      status: deriveStatus(updated),
      disconnect,
    });
  }

  if (action === "extend") {
    const parsed = extendTokenSchema.safeParse({
      expiresAt: body.expiresAt,
      addUses: body.addUses,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Dados inválidos", issues: parsed.error.flatten() },
        { status: 400 },
      );
    }
    if (existing.revokedAt) {
      return NextResponse.json({ error: "Token revogado não pode ser estendido" }, { status: 409 });
    }
    const data: { expiresAt?: Date; maxUses?: number } = {};
    if (parsed.data.expiresAt) {
      if (parsed.data.expiresAt.getTime() <= Date.now()) {
        return NextResponse.json({ error: "Nova data de expiração deve ser futura" }, { status: 400 });
      }
      data.expiresAt = parsed.data.expiresAt;
    }
    if (parsed.data.addUses) {
      data.maxUses = existing.maxUses + parsed.data.addUses;
    }
    const updated = await prisma.accessToken.update({ where: { id }, data });
    return NextResponse.json({ ...updated, status: deriveStatus(updated) });
  }

  return NextResponse.json({ error: "Ação inválida" }, { status: 400 });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const existing = await prisma.accessToken.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Token não encontrado" }, { status: 404 });
  }
  if (existing.usedCount > 0) {
    return NextResponse.json(
      { error: "Token já foi usado — revogue em vez de excluir" },
      { status: 409 },
    );
  }
  await prisma.accessToken.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
