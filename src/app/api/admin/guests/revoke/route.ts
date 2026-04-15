import { NextRequest, NextResponse } from "next/server";
import { unauthorizeGuest } from "@/lib/unifi";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const mac = typeof body.mac === "string" ? body.mac : "";
  if (!mac) return NextResponse.json({ error: "MAC ausente" }, { status: 400 });

  try {
    await unauthorizeGuest(mac);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
