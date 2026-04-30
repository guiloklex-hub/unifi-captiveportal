import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const now = new Date();

  // Agregados por status (calculados em memória — SQLite não suporta column-vs-column).
  const [allTokens, totalUsages, topUsage, recent] = await Promise.all([
    prisma.accessToken.findMany({
      select: {
        id: true,
        code: true,
        description: true,
        usedCount: true,
        maxUses: true,
        expiresAt: true,
        revokedAt: true,
        createdAt: true,
        firstUsedAt: true,
      },
    }),
    prisma.guestRegistration.count({ where: { tokenId: { not: null } } }),
    prisma.accessToken.findMany({
      where: { usedCount: { gt: 0 } },
      orderBy: { usedCount: "desc" },
      take: 10,
      select: {
        id: true,
        code: true,
        description: true,
        usedCount: true,
        maxUses: true,
      },
    }),
    prisma.guestRegistration.findMany({
      where: { tokenId: { not: null } },
      orderBy: { authorizedAt: "desc" },
      take: 20,
      select: {
        id: true,
        macAddress: true,
        fullName: true,
        authorizedAt: true,
        token: { select: { code: true, description: true } },
      },
    }),
  ]);

  let active = 0;
  let expired = 0;
  let revoked = 0;
  let exhausted = 0;
  const ttfuSamples: number[] = [];
  for (const t of allTokens) {
    if (t.revokedAt) revoked += 1;
    else if (t.expiresAt.getTime() <= now.getTime()) expired += 1;
    else if (t.usedCount >= t.maxUses) exhausted += 1;
    else active += 1;
    if (t.firstUsedAt) {
      ttfuSamples.push(t.firstUsedAt.getTime() - t.createdAt.getTime());
    }
  }
  const avgTtfuMs = ttfuSamples.length > 0
    ? Math.round(ttfuSamples.reduce((a, b) => a + b, 0) / ttfuSamples.length)
    : 0;

  return NextResponse.json({
    counts: {
      total: allTokens.length,
      active,
      expired,
      revoked,
      exhausted,
    },
    totalUsages,
    avgTimeToFirstUseMs: avgTtfuMs,
    topUsage,
    recent,
  });
}
