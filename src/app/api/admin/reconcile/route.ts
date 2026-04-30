import { NextRequest, NextResponse } from "next/server";
import { reconcileActiveSessions } from "@/lib/reconcile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const site = sp.get("site");
  const result = await reconcileActiveSessions(site);
  return NextResponse.json(result);
}
