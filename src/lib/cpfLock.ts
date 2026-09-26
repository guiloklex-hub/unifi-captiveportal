import { prisma } from "./prisma";

export interface ActiveCpfConflict {
  id: number;
  macAddress: string;
  authorizedAt: Date;
  durationMin: number;
}

/**
 * Procura uma autorização **viva** do mesmo CPF em outro MAC.
 *
 * Critério canônico de sessão ativa:
 *   revokedAt IS NULL
 *   AND authorizedAt + durationMin minutos > agora
 *
 * SQLite não suporta aritmética de duração no Prisma `where`, então o filtro
 * temporal é feito em JS sobre um conjunto pequeno de candidatos (mesmo CPF,
 * MAC distinto, ainda não revogados, ordenados pelos mais recentes).
 */
export async function findActiveCpfOnOtherDevice(
  cpf: string,
  mac: string,
): Promise<ActiveCpfConflict | null> {
  const now = Date.now();

  const candidates = await prisma.guestRegistration.findMany({
    where: {
      cpf,
      macAddress: { not: mac },
      revokedAt: null,
    },
    select: { id: true, macAddress: true, authorizedAt: true, durationMin: true },
    orderBy: { authorizedAt: "desc" },
    take: 50,
  });

  for (const c of candidates) {
    const expiresAt = c.authorizedAt.getTime() + c.durationMin * 60_000;
    if (expiresAt > now) return c;
  }
  return null;
}

export interface RevokedDevice {
  mac: string;
  site: string | null;
}

/**
 * Marca como revogadas todas as sessões vivas (revokedAt IS NULL) de um CPF.
 * Retorna os pares MAC+site afetados para que o caller possa propagar o
 * unauthorize na UniFi no site correto (best-effort, fora desta função).
 */
export async function revokeActiveCpfSessions(cpf: string): Promise<RevokedDevice[]> {
  const rows = await prisma.guestRegistration.findMany({
    where: { cpf, revokedAt: null },
    select: { macAddress: true, site: true },
  });

  if (rows.length === 0) return [];

  await prisma.guestRegistration.updateMany({
    where: { cpf, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  const unique = new Map<string, RevokedDevice>();
  for (const r of rows) unique.set(`${r.macAddress}|${r.site ?? ""}`, { mac: r.macAddress, site: r.site });
  return [...unique.values()];
}
