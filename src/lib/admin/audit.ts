import { prisma } from "../prisma";
import { logger } from "../logger";
import { clientIp } from "../rateLimit";

/**
 * Trilha de auditoria. O proxy injeta `x-admin-user` nas requisições
 * autenticadas; o registro é best-effort (falha no log não quebra a ação).
 */
export const ACTOR_HEADER = "x-admin-user";
export const ROLE_HEADER = "x-admin-role";

type HeaderSource = { headers: Pick<Headers, "get"> };

export function actorOf(req: HeaderSource): string {
  return req.headers.get(ACTOR_HEADER) ?? "desconhecido";
}

export async function audit(
  req: HeaderSource | null,
  action: string,
  target?: string | null,
  details?: Record<string, unknown>,
  actorOverride?: string,
): Promise<void> {
  const actor = actorOverride ?? (req ? actorOf(req) : "system");
  const ip = req ? clientIp(req.headers as Headers) : null;
  try {
    await prisma.auditLog.create({
      data: {
        actor,
        action,
        target: target ?? null,
        details: details ? JSON.stringify(details).slice(0, 4000) : null,
        ip: ip && ip !== "unknown" ? ip : null,
      },
    });
  } catch (err) {
    logger.warn({ action, err: (err as Error).message }, "audit write failed");
  }
}
