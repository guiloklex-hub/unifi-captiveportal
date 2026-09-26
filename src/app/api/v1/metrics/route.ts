import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/integrations/apiKeys";
import { computeMetrics } from "@/lib/integrations/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/metrics?days=30&site= — agregados sem dados pessoais (BI, Power BI, Grafana…). */
export async function GET(req: NextRequest) {
  const auth = await requireApiKey(req, "read");
  if ("response" in auth) return auth.response;
  const days = Math.min(366, Math.max(1, parseInt(req.nextUrl.searchParams.get("days") ?? "30", 10) || 30));
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  return NextResponse.json(await computeMetrics(from, to, req.nextUrl.searchParams.get("site")));
}
