import { prisma } from "./prisma";
import { lastStatsStrategy, listActiveGuests, unauthorizeGuest, type UniFiGuest, type UniFiStrategy } from "./unifi";
import { logger } from "./logger";

export type ReconcileResult = {
  ok: boolean;
  /** Guests devolvidos pela controladora. */
  active: number;
  /** Registros locais atualizados (lastSeenAt). */
  updated: number;
  /** Desses, quantos receberam contadores de tráfego. */
  withTraffic: number;
  /** Forma de conexão usada para ler os guests. */
  strategy: UniFiStrategy | null;
  error?: string;
};

function hasCounters(g: UniFiGuest): boolean {
  return typeof g.tx_bytes === "number" || typeof g.rx_bytes === "number";
}

function totalBytes(g: UniFiGuest): number {
  return (g.tx_bytes ?? 0) + (g.rx_bytes ?? 0);
}

/**
 * Um registro por MAC. A API legada (`/stat/guest`) devolve também autorizações
 * antigas do mesmo aparelho: vale a mais recente (maior `start`), e no empate a
 * que tem contadores/mais bytes — sem isso, um registro antigo podia sobrescrever
 * o tráfego da sessão atual conforme a ordem da resposta.
 */
export function latestGuestByMac(guests: UniFiGuest[]): Map<string, UniFiGuest> {
  const out = new Map<string, UniFiGuest>();
  for (const g of guests) {
    if (!g.mac) continue;
    const mac = g.mac.toLowerCase();
    const cur = out.get(mac);
    if (!cur) {
      out.set(mac, g);
      continue;
    }
    const a = g.start ?? 0;
    const b = cur.start ?? 0;
    if (a > b || (a === b && (Number(hasCounters(g)) > Number(hasCounters(cur)) || totalBytes(g) > totalBytes(cur)))) {
      out.set(mac, g);
    }
  }
  return out;
}

/**
 * Reconcilia o estado de sessões UniFi com o GuestRegistration local:
 * atualiza bytesTx/bytesRx/lastSeenAt do registro mais recente de cada MAC
 * conhecido pela controladora.
 *
 * Quando a fonte não informa contadores, os bytes já gravados são mantidos
 * (antes eram zerados para null). Tolerante a erro — logs para diagnóstico.
 */
export async function reconcileActiveSessions(siteOverride?: string | null): Promise<ReconcileResult> {
  const startedAt = Date.now();
  let unifiGuests: UniFiGuest[];
  try {
    unifiGuests = await listActiveGuests(siteOverride, { withTraffic: true });
  } catch (err) {
    const msg = (err as Error).message;
    logger.warn({ err: msg, site: siteOverride }, "Reconcile failed to list UniFi guests");
    return { ok: false, active: 0, updated: 0, withTraffic: 0, strategy: lastStatsStrategy(), error: msg };
  }

  const strategy = lastStatsStrategy();
  const now = new Date();
  let updated = 0;
  let withTraffic = 0;

  const byMac = latestGuestByMac(unifiGuests);
  if (byMac.size === 0) {
    logger.info({ active: unifiGuests.length, updated, strategy, ms: Date.now() - startedAt }, "Reconcile cycle complete");
    return { ok: true, active: unifiGuests.length, updated, withTraffic, strategy };
  }

  // Uma consulta para todos os MACs (antes: 1 findFirst por guest ativo — N+1).
  // Ordenado DESC: o primeiro registro visto por MAC é o mais recente.
  const rows = await prisma.guestRegistration.findMany({
    where: { macAddress: { in: [...byMac.keys()] } },
    orderBy: { authorizedAt: "desc" },
    select: { id: true, macAddress: true },
  });
  const latestIdByMac = new Map<string, number>();
  for (const r of rows) {
    if (!latestIdByMac.has(r.macAddress)) latestIdByMac.set(r.macAddress, r.id);
  }

  for (const [mac, g] of byMac) {
    const id = latestIdByMac.get(mac);
    if (id === undefined) continue;

    const traffic = hasCounters(g);
    try {
      await prisma.guestRegistration.update({
        where: { id },
        data: {
          ...(typeof g.tx_bytes === "number" ? { bytesTx: BigInt(Math.trunc(g.tx_bytes)) } : {}),
          ...(typeof g.rx_bytes === "number" ? { bytesRx: BigInt(Math.trunc(g.rx_bytes)) } : {}),
          lastSeenAt: now,
          ...(traffic ? { reconciledAt: now } : {}),
        },
      });
      updated += 1;
      if (traffic) withTraffic += 1;
    } catch (err) {
      logger.warn({ mac, err: (err as Error).message }, "Reconcile update failed");
    }
  }

  if (updated > 0 && withTraffic === 0) {
    logger.warn(
      { strategy, updated },
      "Reconcile: a controladora não informou contadores de tráfego para nenhum guest",
    );
  }
  logger.info(
    { active: unifiGuests.length, updated, withTraffic, strategy, ms: Date.now() - startedAt },
    "Reconcile cycle complete",
  );
  return { ok: true, active: unifiGuests.length, updated, withTraffic, strategy };
}

/**
 * Grava o tráfego final de uma autorização revogada no registro mais recente do
 * MAC. Best-effort: nunca lança (a revogação já aconteceu na controladora).
 * Retorna `true` quando havia contadores e o registro foi atualizado.
 */
export async function saveRevokedTraffic(mac: string, usage: UniFiGuest | null): Promise<boolean> {
  if (!usage || !hasCounters(usage)) return false;
  const target = mac.toLowerCase();
  try {
    const reg = await prisma.guestRegistration.findFirst({
      where: { macAddress: target },
      orderBy: { authorizedAt: "desc" },
      select: { id: true },
    });
    if (!reg) return false;
    const now = new Date();
    await prisma.guestRegistration.update({
      where: { id: reg.id },
      data: {
        ...(typeof usage.tx_bytes === "number" ? { bytesTx: BigInt(Math.trunc(usage.tx_bytes)) } : {}),
        ...(typeof usage.rx_bytes === "number" ? { bytesRx: BigInt(Math.trunc(usage.rx_bytes)) } : {}),
        lastSeenAt: now,
        reconciledAt: now,
      },
    });
    logger.info(
      { mac: target, id: reg.id, tx: usage.tx_bytes, rx: usage.rx_bytes },
      "Tráfego final da sessão revogada gravado",
    );
    return true;
  } catch (err) {
    logger.warn({ mac: target, err: (err as Error).message }, "Falha ao gravar o tráfego final da sessão revogada");
    return false;
  }
}

/**
 * Revoga o guest na controladora e guarda o tráfego final devolvido pela API
 * oficial — sem isso, os bytes entre a última reconciliação e a revogação se
 * perdiam (o guest some da listagem da API oficial ao ser desconectado).
 * Erros da controladora são propagados, como em `unauthorizeGuest`.
 */
export async function unauthorizeGuestAndSaveTraffic(mac: string, site?: string | null): Promise<void> {
  const usage = await unauthorizeGuest(mac, site);
  await saveRevokedTraffic(mac, usage);
}
