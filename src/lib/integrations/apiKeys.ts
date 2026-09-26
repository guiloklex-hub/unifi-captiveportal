import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "../prisma";
import { rateLimit } from "../rateLimit";

/**
 * Chaves da API pública: `ucp_<prefixo>_<segredo>`. Guardamos só o SHA-256 do
 * segredo; a chave completa é exibida uma única vez na criação.
 *
 * Escopos:
 *   read      métricas, sessões e registros sem dados pessoais
 *   read:pii  registros com nome, e-mail, telefone e documento
 *   write     criar vouchers e liberar dispositivos
 */

export const API_SCOPES = ["read", "read:pii", "write"] as const;
export type ApiScope = (typeof API_SCOPES)[number];

const RATE_LIMIT_PER_MIN = 120;

function sha256(v: string): string {
  return createHash("sha256").update(v).digest("hex");
}

export function generateApiKey(): { key: string; prefix: string; hash: string } {
  const prefix = randomBytes(6).toString("hex");
  const secret = randomBytes(24).toString("base64url");
  return { key: `ucp_${prefix}_${secret}`, prefix, hash: sha256(secret) };
}

export type ApiCaller = { id: string; name: string; scopes: ApiScope[] };

export async function authenticateApiKey(authorization: string | null): Promise<ApiCaller | null> {
  const m = /^Bearer\s+ucp_([0-9a-f]{12})_([A-Za-z0-9_-]{20,})$/.exec(authorization ?? "");
  if (!m) return null;
  const key = await prisma.apiKey.findUnique({ where: { prefix: m[1] } });
  if (!key || key.revokedAt) return null;
  const a = Buffer.from(key.hash, "hex");
  const b = Buffer.from(sha256(m[2]), "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  // lastUsedAt com baixa precisão para não escrever no banco a cada chamada.
  if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > 60_000) {
    await prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
  }
  return { id: key.id, name: key.name, scopes: key.scopes.split(",").map((s) => s.trim()) as ApiScope[] };
}

/**
 * Autentica e autoriza uma chamada à API pública. Devolve o chamador ou a
 * resposta de erro pronta (401/403/429).
 */
export async function requireApiKey(
  req: NextRequest,
  scope: ApiScope,
): Promise<{ caller: ApiCaller } | { response: NextResponse }> {
  const caller = await authenticateApiKey(req.headers.get("authorization"));
  if (!caller) {
    return {
      response: NextResponse.json(
        { error: "unauthorized", message: "Use Authorization: Bearer ucp_…" },
        { status: 401, headers: { "WWW-Authenticate": "Bearer" } },
      ),
    };
  }
  const rl = rateLimit(`api-v1:${caller.id}`, RATE_LIMIT_PER_MIN, 60_000);
  if (!rl.allowed) {
    return {
      response: NextResponse.json(
        { error: "rate_limited" },
        { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } },
      ),
    };
  }
  const has = caller.scopes.includes(scope) || (scope === "read" && caller.scopes.includes("read:pii"));
  if (!has) return { response: NextResponse.json({ error: "forbidden", message: `Escopo necessário: ${scope}` }, { status: 403 }) };
  return { caller };
}
