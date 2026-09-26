import { prisma } from "../prisma";
import type { SystemSettings } from "../settings";
import type { GuestIdentity } from "./grantAccess";

/**
 * "Lembrar dispositivo": quem já se cadastrou neste MAC nos últimos N dias
 * reconecta com um clique, reaproveitando o cadastro.
 *
 * Desligado quando o portal exige token (o admin controla o acesso) e quando a
 * última sessão foi revogada manualmente pelo admin.
 *
 * Risco aceito e documentado: MAC pode ser clonado. Só o primeiro nome é
 * exibido na tela, para não expor dados pessoais a quem forjar um MAC.
 */
export type ReturningGuest = { firstName: string; identity: GuestIdentity };

export function rememberEnabled(settings: SystemSettings): boolean {
  return settings.rememberDeviceDays > 0 && !settings.requireToken;
}

export async function findReturningGuest(mac: string, settings: SystemSettings): Promise<ReturningGuest | null> {
  if (!rememberEnabled(settings)) return null;
  const since = new Date(Date.now() - settings.rememberDeviceDays * 24 * 60 * 60 * 1000);
  const last = await prisma.guestRegistration.findFirst({
    where: { macAddress: mac.toLowerCase(), authorizedAt: { gte: since } },
    orderBy: { authorizedAt: "desc" },
    select: {
      fullName: true,
      email: true,
      phone: true,
      cpf: true,
      documentType: true,
      document: true,
      revokedAt: true,
    },
  });
  if (!last || last.revokedAt) return null;
  const { revokedAt: _revoked, ...identity } = last;
  void _revoked;
  return { firstName: identity.fullName.split(/\s+/)[0] ?? "", identity };
}
