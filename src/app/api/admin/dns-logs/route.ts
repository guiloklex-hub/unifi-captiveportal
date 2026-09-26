import { NextRequest, NextResponse } from "next/server";
import { getAdGuardLogs } from "@/lib/adguard";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

// Autenticação: proxy (src/proxy.ts) protege /api/admin/*.
export async function GET(req: NextRequest) {
  const ip = req.nextUrl.searchParams.get("ip");
  if (!ip) {
    return NextResponse.json({ error: "IP address is required" }, { status: 400 });
  }

  try {
    return NextResponse.json(await getAdGuardLogs(ip));
  } catch (error) {
    logger.error({ err: (error as Error).message }, "dns-logs: AdGuard request failed");
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch DNS logs" },
      { status: 500 },
    );
  }
}
