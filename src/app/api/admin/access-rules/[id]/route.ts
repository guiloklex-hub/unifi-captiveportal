import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/admin/audit";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const rule = await prisma.accessRule.findUnique({ where: { id } });
  if (!rule) return NextResponse.json({ error: "Regra não encontrada" }, { status: 404 });
  await prisma.accessRule.delete({ where: { id } });
  await audit(req, `rule.${rule.kind}.remove`, `${rule.matchType}:${rule.value}`);
  return NextResponse.json({ ok: true });
}
