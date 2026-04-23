import { NextResponse } from "next/server";
import { checkUnifiHealth } from "@/lib/unifi";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = new Date().toISOString();

  const [unifi, db] = await Promise.allSettled([
    checkUnifiHealth(),
    prisma.$queryRaw`SELECT 1`.then(() => "ok" as const),
  ]);

  const unifiResult =
    unifi.status === "fulfilled"
      ? unifi.value
      : { status: "down" as const, circuitOpenUntil: null, cachedSessionValid: false, failures: 0 };

  const dbResult = db.status === "fulfilled" ? "ok" : "down";

  const overall =
    unifiResult.status === "ok" && dbResult === "ok"
      ? "ok"
      : unifiResult.status === "down" || dbResult === "down"
        ? "down"
        : "degraded";

  const httpStatus = overall === "ok" ? 200 : overall === "degraded" ? 200 : 503;

  return NextResponse.json(
    {
      status: overall,
      checkedAt: startedAt,
      unifi: unifiResult,
      db: dbResult,
    },
    { status: httpStatus },
  );
}
