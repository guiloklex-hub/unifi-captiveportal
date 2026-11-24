import { NextRequest, NextResponse } from "next/server";
import { reconcileActiveSessions } from "@/lib/reconcile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const site = sp.get("site");
  const result = await reconcileActiveSessions(site);
  // 502 em falha: o botão do painel mostra o erro em vez de "0 atualizadas".
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
