import { prisma } from "../prisma";
import { LEGACY_UID, verifySessionToken } from "../auth";
import type { AdminRole } from "./rbac";

export type AdminIdentity = { uid: string; username: string; role: AdminRole; legacy: boolean };

/**
 * Login legado por ADMIN_PASSWORD: permitido enquanto não houver nenhum
 * usuário cadastrado (bootstrap) ou com ADMIN_BREAK_GLASS=true (emergência —
 * ex.: único admin perdeu o 2FA).
 */
export async function legacyLoginAllowed(): Promise<boolean> {
  if (!process.env.ADMIN_PASSWORD) return false;
  if (process.env.ADMIN_BREAK_GLASS === "true") return true;
  return (await prisma.adminUser.count()) === 0;
}

// Cache curto: o proxy valida toda requisição do painel.
const CACHE_TTL_MS = 10_000;
type Cached = { value: AdminIdentity | null; expiresAt: number };
const g = globalThis as unknown as { __adminSessionCache?: Map<string, Cached> };

export function invalidateAdminSessions(): void {
  g.__adminSessionCache = new Map();
}

/**
 * Sessão válida = assinatura/validade OK + usuário existente, ativo e com a
 * mesma `sessionVersion` do token (troca de senha/desativação derruba sessões).
 */
export async function getAdminSession(token: string | undefined | null): Promise<AdminIdentity | null> {
  if (!token) return null;
  const cache = (g.__adminSessionCache ??= new Map());
  const hit = cache.get(token);
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  const p = await verifySessionToken(token);
  let value: AdminIdentity | null = null;
  if (p) {
    if (p.uid === LEGACY_UID) {
      value = (await legacyLoginAllowed()) ? { uid: LEGACY_UID, username: "admin", role: "admin", legacy: true } : null;
    } else {
      const user = await prisma.adminUser.findUnique({
        where: { id: p.uid },
        select: { id: true, username: true, role: true, disabled: true, sessionVersion: true },
      });
      if (user && !user.disabled && user.sessionVersion === p.v) {
        value = { uid: user.id, username: user.username, role: user.role as AdminRole, legacy: false };
      }
    }
  }
  if (cache.size > 1000) cache.clear();
  cache.set(token, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}
