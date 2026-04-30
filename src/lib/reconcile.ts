import { prisma } from "./prisma";
import { listActiveGuests, type UniFiGuest } from "./unifi";
import { logger } from "./logger";

/**
 * Reconcilia o estado de sessões UniFi com o GuestRegistration local:
 * atualiza bytesTx/bytesRx/lastSeenAt para cada MAC ativo na controladora.
 *
 * Estratégia: agrupa guests UniFi por MAC, busca o registro mais recente
 * por MAC, faz update em massa. Tolerante a erro — logs para diagnóstico.
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

  for (const g of unifiGuests) {
    if (!g.mac) continue;
    const mac = g.mac.toLowerCase();
    // Busca o registro mais recente para este MAC (em qualquer dia).
    const reg = await prisma.guestRegistration.findFirst({
      where: { macAddress: mac },
      orderBy: { authorizedAt: "desc" },
      select: { id: true },
    });
    if (!reg) continue;

    try {
      await prisma.guestRegistration.update({
        where: { id: reg.id },
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
