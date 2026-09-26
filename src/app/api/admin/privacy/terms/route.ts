import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { piiRetentionDays } from "@/lib/privacy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Versões dos termos aceitas + configuração de retenção. */
export async function GET() {
  const [versions, counts, anonymized] = await Promise.all([
    prisma.termsVersion.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.guestRegistration.groupBy({ by: ["termsHash"], _count: { _all: true } }),
    prisma.guestRegistration.count({ where: { anonymizedAt: { not: null } } }),
  ]);
  const byHash = new Map(counts.map((c) => [c.termsHash, c._count._all]));
  const retention = parseInt(process.env.GUEST_RETENTION_DAYS ?? "", 10);
  return NextResponse.json({
    versions: versions.map((v) => ({ ...v, acceptances: byHash.get(v.hash) ?? 0 })),
    withoutVersion: byHash.get(null) ?? 0,
    anonymized,
    retentionDays: Number.isFinite(retention) && retention >= 7 ? retention : 365,
    piiRetentionDays: piiRetentionDays(),
  });
}
