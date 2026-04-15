/**
 * Autenticação do painel admin.
 * Usa Web Crypto API (globalThis.crypto.subtle) para ser compatível
 * com o Edge Runtime do Next.js middleware.
 */

const COOKIE_NAME = "admin_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function enc(s: string): ArrayBuffer {
  const u8 = new TextEncoder().encode(s);
  // slice garante ArrayBuffer (não SharedArrayBuffer) — exigido pelo Web Crypto API
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

function secretKey(): string {
  const s = process.env.ADMIN_SECRET;
  if (!s || s.length < 16) throw new Error("ADMIN_SECRET ausente ou muito curto");
  return s;
}

async function getHmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    enc(secretKey()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
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

export async function createSessionToken(): Promise<string> {
  const issuedAt = Date.now().toString();
  const key = await getHmacKey();
  const sig = await crypto.subtle.sign("HMAC", key, enc(issuedAt));
  return `${issuedAt}.${bufToHex(sig)}`;
}

export async function verifySessionToken(
  token: string | undefined | null,
): Promise<boolean> {
  if (!token) return false;
  const dotIdx = token.indexOf(".");
  if (dotIdx === -1) return false;
  const issuedAt = token.slice(0, dotIdx);
  const sigHex = token.slice(dotIdx + 1);
  if (!issuedAt || !sigHex) return false;

  const ts = parseInt(issuedAt, 10);
  if (!Number.isFinite(ts)) return false;
  if (Date.now() - ts > SESSION_TTL_MS) return false;

  try {
    const key = await getHmacKey();
    const valid = await crypto.subtle.verify("HMAC", key, hexToBuf(sigHex), enc(issuedAt));
    return valid;
  } catch {
    return false;
  }
}

/** Comparação de senha — apenas em contextos Node (route handlers). */
export async function checkAdminPassword(password: string): Promise<boolean> {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;
  // Timing-safe via subtle.verify com um HMAC de chave fixa
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      enc("pw-compare"),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
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
