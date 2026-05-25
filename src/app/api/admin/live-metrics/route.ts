import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { listActiveGuests } from "@/lib/unifi";
import { bigIntToNumber } from "@/lib/format";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [tokens24h, onlineRaw, traffic24h] = await Promise.allSettled([
    prisma.accessToken.count({ where: { createdAt: { gte: since } } }),
    listActiveGuests(),
    prisma.guestRegistration.aggregate({
      where: { authorizedAt: { gte: since } },
      _sum: { bytesTx: true, bytesRx: true },
    }),
  ]);

  const tokens24hValue = tokens24h.status === "fulfilled" ? tokens24h.value : null;

  let onlineNow: number | null;
  if (onlineRaw.status === "fulfilled") {
    onlineNow = onlineRaw.value.length;
  } else {
    onlineNow = null;
    logger.warn(
      { err: (onlineRaw.reason as Error)?.message },
      "live-metrics: listActiveGuests failed",
    );
  }

  let traffic24hBytes: number | null;
  if (traffic24h.status === "fulfilled") {
    const tx = bigIntToNumber(traffic24h.value._sum.bytesTx);
    const rx = bigIntToNumber(traffic24h.value._sum.bytesRx);
    traffic24hBytes = tx + rx;
  } else {
    traffic24hBytes = null;
  }

  return NextResponse.json({
    tokens24h: tokens24hValue,
    onlineNow,
    traffic24hBytes,
    uptimeSec: Math.floor(process.uptime()),
    checkedAt: new Date().toISOString(),
  });
}
