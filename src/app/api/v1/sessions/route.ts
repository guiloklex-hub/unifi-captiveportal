import { NextRequest, NextResponse } from "next/server";
import { isGuestOnline, listActiveGuests } from "@/lib/unifi";
import { requireApiKey } from "@/lib/integrations/apiKeys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/sessions?site= — guests conectados agora (dados da controladora). */
export async function GET(req: NextRequest) {
  const auth = await requireApiKey(req, "read");
  if ("response" in auth) return auth.response;
  try {
    const guests = (await listActiveGuests(req.nextUrl.searchParams.get("site"))).filter(isGuestOnline);
    return NextResponse.json({
      data: guests.map((g) => ({
        mac: g.mac,
        ip: g.ip ?? null,
        ssid: g.essid ?? null,
        apMac: g.ap_mac ?? null,
        startedAt: g.start ? new Date(g.start * 1000).toISOString() : null,
        endsAt: g.end ? new Date(g.end * 1000).toISOString() : null,
        bytesTx: g.tx_bytes ?? null,
        bytesRx: g.rx_bytes ?? null,
      })),
    });
  } catch {
    return NextResponse.json({ error: "unifi_unavailable" }, { status: 502 });
  }
}
