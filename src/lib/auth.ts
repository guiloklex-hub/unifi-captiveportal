/**
 * Tokens de sessão do painel admin (cookie `admin_session`).
 *
 * Formato: `v2.<payload base64url>.<HMAC-SHA256 hex>` com payload
 * `{ uid, u, r, v, iat }` — id, usuário, papel, versão de sessão e emissão.
 * A assinatura usa ADMIN_SECRET. Revogação (troca de senha, usuário
 * desativado) é feita comparando `v` com `AdminUser.sessionVersion` — ver
 * src/lib/admin/session.ts.
 *
 * Usa Web Crypto (globalThis.crypto.subtle).
 */
import type { AdminRole } from "./admin/rbac";

const COOKIE_NAME = "admin_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MFA_TTL_MS = 5 * 60 * 1000;

/** uid reservado para o login legado por ADMIN_PASSWORD (antes de existir usuários). */
export const LEGACY_UID = "legacy-admin";

export type SessionPayload = {
  uid: string;
  u: string;
  r: AdminRole;
  v: number;
  iat: number;
};

function enc(s: string): ArrayBuffer {
  const u8 = new TextEncoder().encode(s);
  // slice garante ArrayBuffer (não SharedArrayBuffer) — exigido pelo Web Crypto API
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

function secretKey(): string {
  const s = process.env.ADMIN_SECRET;
  // 32 chars (= 16 bytes hex) é o mínimo prático para HMAC-SHA256. Em prod,
  // gere com `openssl rand -hex 32` (64 chars).
  if (!s || s.length < 32) {
    throw new Error("ADMIN_SECRET ausente ou com menos de 32 caracteres");
  }
  return s;
}

async function getHmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", enc(secretKey()), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

function bufToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBuf(hex: string): Uint8Array<ArrayBuffer> {
  const ab = new ArrayBuffer(hex.length / 2);
  const bytes = new Uint8Array(ab);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function b64urlEncode(s: string): string {
  return Buffer.from(s, "utf8").toString("base64url");
}

function b64urlDecode(s: string): string {
  return Buffer.from(s, "base64url").toString("utf8");
}

async function sign(kind: string, body: string): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", await getHmacKey(), enc(`${kind}.${body}`));
  return bufToHex(sig);
}

async function verifySigned(kind: string, token: string | undefined | null): Promise<Record<string, unknown> | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== kind || !/^[0-9a-f]{64}$/.test(parts[2])) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await getHmacKey(), hexToBuf(parts[2]), enc(`${kind}.${parts[1]}`));
    if (!ok) return null;
    return JSON.parse(b64urlDecode(parts[1])) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function createSessionToken(p: Omit<SessionPayload, "iat">): Promise<string> {
  const body = b64urlEncode(JSON.stringify({ ...p, iat: Date.now() }));
  return `v2.${body}.${await sign("v2", body)}`;
}

/** Valida assinatura e validade. Não consulta o banco (ver admin/session.ts). */
export async function verifySessionToken(token: string | undefined | null): Promise<SessionPayload | null> {
  const p = await verifySigned("v2", token);
  if (!p) return null;
  const iat = Number(p.iat);
  if (!Number.isFinite(iat) || Date.now() - iat > SESSION_TTL_MS || iat > Date.now() + 60_000) return null;
  if (typeof p.uid !== "string" || typeof p.u !== "string" || typeof p.r !== "string") return null;
  return { uid: p.uid, u: p.u, r: p.r as AdminRole, v: Number(p.v) || 0, iat };
}

/** Token intermediário entre senha correta e código 2FA (5 minutos). */
export async function createMfaToken(uid: string): Promise<string> {
  const body = b64urlEncode(JSON.stringify({ uid, iat: Date.now() }));
  return `mfa.${body}.${await sign("mfa", body)}`;
}

export async function verifyMfaToken(token: string | undefined | null): Promise<string | null> {
  const p = await verifySigned("mfa", token);
  if (!p || typeof p.uid !== "string") return null;
  if (Date.now() - Number(p.iat) > MFA_TTL_MS) return null;
  return p.uid;
}

/** Comparação da senha legada (ADMIN_PASSWORD) — timing-safe. */
export async function checkAdminPassword(password: string): Promise<boolean> {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;
  try {
    const key = await crypto.subtle.importKey("raw", enc("pw-compare"), { name: "HMAC", hash: "SHA-256" }, false, [
      "sign",
      "verify",
    ]);
    const [ha, hb] = await Promise.all([
      crypto.subtle.sign("HMAC", key, enc(password)),
      crypto.subtle.sign("HMAC", key, enc(expected)),
    ]);
    const a = new Uint8Array(ha);
    const b = new Uint8Array(hb);
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
  } catch {
    return false;
  }
}

export const ADMIN_COOKIE = COOKIE_NAME;
export const ADMIN_COOKIE_MAX_AGE = SESSION_TTL_MS / 1000;
