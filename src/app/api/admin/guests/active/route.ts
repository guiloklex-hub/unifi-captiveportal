import { NextResponse } from "next/server";
import { listActiveGuests } from "@/lib/unifi";
import { prisma } from "@/lib/prisma";
import { jsonSafe } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const guests = await listActiveGuests();

    // Sincroniza métricas no SQLite (bytes e lastSeen) por MAC
    await Promise.all(
      guests.map(async (g) => {
        const mac = g.mac.toLowerCase();
        const reg = await prisma.guestRegistration.findFirst({
          where: { macAddress: mac },
          orderBy: { authorizedAt: "desc" },
        });
        if (!reg) return;
        await prisma.guestRegistration.update({
          where: { id: reg.id },
          data: {
            bytesTx: g.tx_bytes ? BigInt(g.tx_bytes) : reg.bytesTx,
            bytesRx: g.rx_bytes ? BigInt(g.rx_bytes) : reg.bytesRx,
            lastSeenAt: new Date(),
          },
        });
      }),
    );

    return NextResponse.json(jsonSafe({ guests }));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
