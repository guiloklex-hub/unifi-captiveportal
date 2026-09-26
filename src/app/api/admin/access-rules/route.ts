import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { accessRuleSchema } from "@/lib/portal/accessRules";
import { actorOf, audit } from "@/lib/admin/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const kind = req.nextUrl.searchParams.get("kind");
  const rules = await prisma.accessRule.findMany({
    where: kind === "block" || kind === "allow" ? { kind } : {},
    orderBy: { createdAt: "desc" },
    take: 1000,
  });
  return NextResponse.json({ rules });
}

export async function POST(req: NextRequest) {
  const parsed = accessRuleSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos", issues: z.flattenError(parsed.error) }, { status: 400 });
  }
  const r = parsed.data;
  const data = {
    reason: r.reason || null,
    durationMin: r.kind === "allow" ? (r.durationMin ?? null) : null,
    expiresAt: r.expiresAt ?? null,
    createdBy: actorOf(req),
  };
  const rule = await prisma.accessRule.upsert({
    where: { kind_matchType_value: { kind: r.kind, matchType: r.matchType, value: r.value } },
    create: { kind: r.kind, matchType: r.matchType, value: r.value, ...data },
    update: data,
  });
  await audit(req, `rule.${r.kind}`, `${r.matchType}:${r.value}`, { reason: r.reason, expiresAt: r.expiresAt });
  return NextResponse.json({ rule }, { status: 201 });
}
