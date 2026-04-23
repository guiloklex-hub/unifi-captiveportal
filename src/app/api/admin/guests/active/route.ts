import { NextResponse } from "next/server";
import { listActiveGuests } from "@/lib/unifi";
import { prisma } from "@/lib/prisma";
import { jsonSafe } from "@/lib/utils";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const guests = await listActiveGuests();

    if (guests.length === 0) {
      return NextResponse.json(jsonSafe({ guests }));
    }

    // Batch: 1 query para achar todos os registros mais recentes por MAC
    // (em vez de N findFirst + N update).
    const macs = guests.map((g) => g.mac.toLowerCase());
    const now = new Date();

    // SQLite + Prisma não suporta DISTINCT ON; usamos groupBy para pegar o maior id por MAC,
    // depois buscamos os registros e fazemos um único updateMany condicional por ID.
    const latestIds = await prisma.guestRegistration.groupBy({
      by: ["macAddress"],
      where: { macAddress: { in: macs } },
      _max: { id: true },
    });
    const idByMac = new Map<string, number>();
    for (const row of latestIds) {
      if (row._max.id !== null) idByMac.set(row.macAddress, row._max.id);
    }

    // Atualiza em paralelo, mas limitado pelo conjunto já resolvido (sem N+1 lookups)
    await Promise.all(
      guests.map((g) => {
        const mac = g.mac.toLowerCase();
        const id = idByMac.get(mac);
        if (!id) return Promise.resolve();
        return prisma.guestRegistration.update({
          where: { id },
          data: {
            bytesTx: g.tx_bytes ? BigInt(g.tx_bytes) : undefined,
            bytesRx: g.rx_bytes ? BigInt(g.rx_bytes) : undefined,
            lastSeenAt: now,
          },
        });
      }),
    );

    return NextResponse.json(jsonSafe({ guests }));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro";
    logger.error({ err: message }, "listActiveGuests failed");
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
