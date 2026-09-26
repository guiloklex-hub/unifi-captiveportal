import { prisma } from "../prisma";
import { bigIntToNumber } from "../format";

export type PortalMetrics = {
  from: string;
  to: string;
  connections: number;
  uniqueVisitors: number;
  newVisitors: number;
  marketingConsents: number;
  bytesTotal: number;
  byDay: { date: string; connections: number }[];
  byMethod: Record<string, number>;
  bySite: Record<string, number>;
};

/** Métricas agregadas do período (sem dados pessoais) — API pública e relatório por e-mail. */
export async function computeMetrics(from: Date, to: Date, site?: string | null): Promise<PortalMetrics> {
  const where = { authorizedAt: { gte: from, lt: to }, ...(site ? { site } : {}) };
  const rows = await prisma.guestRegistration.findMany({
    where,
    select: { authorizedAt: true, visitorKey: true, authMethod: true, site: true, marketingConsent: true, bytesTx: true, bytesRx: true },
  });
  const keys = [...new Set(rows.map((r) => r.visitorKey))];
  const seenBefore = keys.length
    ? await prisma.guestRegistration.findMany({
        where: { visitorKey: { in: keys }, authorizedAt: { lt: from } },
        select: { visitorKey: true },
        distinct: ["visitorKey"],
      })
    : [];

  const byDay = new Map<string, number>();
  const byMethod: Record<string, number> = {};
  const bySite: Record<string, number> = {};
  let bytesTotal = 0;
  let marketingConsents = 0;
  for (const r of rows) {
    const day = r.authorizedAt.toISOString().slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
    byMethod[r.authMethod] = (byMethod[r.authMethod] ?? 0) + 1;
    const s = r.site ?? "default";
    bySite[s] = (bySite[s] ?? 0) + 1;
    bytesTotal += bigIntToNumber(r.bytesTx) + bigIntToNumber(r.bytesRx);
    if (r.marketingConsent) marketingConsents++;
  }

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    connections: rows.length,
    uniqueVisitors: keys.length,
    newVisitors: keys.length - seenBefore.length,
    marketingConsents,
    bytesTotal,
    byDay: [...byDay.entries()].sort().map(([date, connections]) => ({ date, connections })),
    byMethod,
    bySite,
  };
}
