import { prisma } from "./prisma";
import { listActiveGuests, type UniFiGuest } from "./unifi";
import { logger } from "./logger";

/**
 * Reconcilia o estado de sessões UniFi com o GuestRegistration local:
 * atualiza bytesTx/bytesRx/lastSeenAt para cada MAC ativo na controladora.
 *
 * Estratégia: busca numa única consulta o registro mais recente de cada MAC
 * ativo e atualiza cada um. Tolerante a erro — logs para diagnóstico.
 */
export async function reconcileActiveSessions(siteOverride?: string | null): Promise<{
  ok: boolean;
  active: number;
  updated: number;
  error?: string;
}> {
  const startedAt = Date.now();
  let unifiGuests: UniFiGuest[];
  try {
    unifiGuests = await listActiveGuests(siteOverride);
  } catch (err) {
    const msg = (err as Error).message;
    logger.warn({ err: msg, site: siteOverride }, "Reconcile failed to list UniFi guests");
    return { ok: false, active: 0, updated: 0, error: msg };
  }

  const now = new Date();
  let updated = 0;

  const macs = [...new Set(unifiGuests.filter((g) => g.mac).map((g) => g.mac.toLowerCase()))];
  if (macs.length === 0) {
    logger.info({ active: unifiGuests.length, updated, ms: Date.now() - startedAt }, "Reconcile cycle complete");
    return { ok: true, active: unifiGuests.length, updated };
  }

  // Uma consulta para todos os MACs (antes: 1 findFirst por guest ativo — N+1).
  // Ordenado DESC: o primeiro registro visto por MAC é o mais recente.
  const rows = await prisma.guestRegistration.findMany({
    where: { macAddress: { in: macs } },
    orderBy: { authorizedAt: "desc" },
    select: { id: true, macAddress: true },
  });
  const latestIdByMac = new Map<string, number>();
  for (const r of rows) {
    if (!latestIdByMac.has(r.macAddress)) latestIdByMac.set(r.macAddress, r.id);
  }

  for (const g of unifiGuests) {
    if (!g.mac) continue;
    const mac = g.mac.toLowerCase();
    const id = latestIdByMac.get(mac);
    if (id === undefined) continue;

    try {
      await prisma.guestRegistration.update({
        where: { id },
        data: {
          bytesTx: typeof g.tx_bytes === "number" ? BigInt(g.tx_bytes) : null,
          bytesRx: typeof g.rx_bytes === "number" ? BigInt(g.rx_bytes) : null,
          lastSeenAt: now,
          reconciledAt: now,
        },
      });
      updated += 1;
    } catch (err) {
      logger.warn({ mac, err: (err as Error).message }, "Reconcile update failed");
    }
  }

  logger.info(
    { active: unifiGuests.length, updated, ms: Date.now() - startedAt },
    "Reconcile cycle complete",
  );
  return { ok: true, active: unifiGuests.length, updated };
}
