import { prisma } from "../prisma";
import { decryptSecret } from "../crypto";
import { LEGACY_UID, checkAdminPassword, createSessionToken } from "../auth";
import { verifyPassword } from "./password";
import { verifyTotp } from "./totp";
import { legacyLoginAllowed } from "./session";
import type { AdminRole } from "./rbac";

export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MS = 15 * 60 * 1000;

export type LoginResult =
  | { status: "ok"; token: string; username: string }
  | { status: "mfa"; uid: string }
  | { status: "invalid" }
  | { status: "locked"; until: Date };

/**
 * Primeiro fator. Com usuários cadastrados: usuário + senha (scrypt), bloqueio
 * temporário após 5 falhas. Sem usuários: senha legada ADMIN_PASSWORD.
 */
export async function passwordLogin(username: string, password: string): Promise<LoginResult> {
  const user = username ? await prisma.adminUser.findUnique({ where: { username: username.toLowerCase() } }) : null;

  if (!user) {
    // Bootstrap/break-glass: ADMIN_PASSWORD (usuário vazio ou "admin").
    if ((!username || username.toLowerCase() === "admin") && (await legacyLoginAllowed())) {
      if (await checkAdminPassword(password)) {
        const token = await createSessionToken({ uid: LEGACY_UID, u: "admin", r: "admin", v: 0 });
        return { status: "ok", token, username: "admin" };
      }
    }
    return { status: "invalid" };
  }

  if (user.disabled) return { status: "invalid" };
  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) return { status: "locked", until: user.lockedUntil };

  if (!(await verifyPassword(password, user.passwordHash))) {
    const failed = user.failedLogins + 1;
    await prisma.adminUser.update({
      where: { id: user.id },
      data: {
        failedLogins: failed >= MAX_FAILED_LOGINS ? 0 : failed,
        lockedUntil: failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCKOUT_MS) : user.lockedUntil,
      },
    });
    return { status: "invalid" };
  }

  if (user.totpEnabled && user.totpSecretEnc) return { status: "mfa", uid: user.id };
  return finishLogin(user.id);
}

/** Segundo fator (TOTP). */
export async function mfaLogin(uid: string, code: string): Promise<LoginResult> {
  const user = await prisma.adminUser.findUnique({ where: { id: uid } });
  if (!user || user.disabled || !user.totpEnabled || !user.totpSecretEnc) return { status: "invalid" };
  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) return { status: "locked", until: user.lockedUntil };
  if (!verifyTotp(decryptSecret(user.totpSecretEnc), code)) {
    const failed = user.failedLogins + 1;
    await prisma.adminUser.update({
      where: { id: uid },
      data: {
        failedLogins: failed >= MAX_FAILED_LOGINS ? 0 : failed,
        lockedUntil: failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCKOUT_MS) : user.lockedUntil,
      },
    });
    return { status: "invalid" };
  }
  return finishLogin(uid);
}

async function finishLogin(uid: string): Promise<LoginResult> {
  const user = await prisma.adminUser.update({
    where: { id: uid },
    data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() },
  });
  const token = await createSessionToken({
    uid: user.id,
    u: user.username,
    r: user.role as AdminRole,
    v: user.sessionVersion,
  });
  return { status: "ok", token, username: user.username };
}
