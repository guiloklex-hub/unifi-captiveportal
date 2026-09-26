import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/admin/audit";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/** Revoga a chave (mantida na lista para histórico). */
export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const key = await prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date() } }).catch(() => null);
  if (!key) return NextResponse.json({ error: "Chave não encontrada" }, { status: 404 });
  await audit(req, "apikey.revoke", `${key.name} (${key.prefix})`);
  return NextResponse.json({ ok: true });
}
