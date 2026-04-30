import { randomBytes } from "crypto";
import type { AccessToken } from "@prisma/client";
import { prisma } from "./prisma";

// Alfabeto sem caracteres ambíguos (sem 0/O, 1/I/L)
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const GROUP_LEN = 4;
const GROUPS = 3;
const RAW_LEN = GROUP_LEN * GROUPS;

export class TokenInvalidError extends Error {
  constructor() {
    super("Token inválido");
    this.name = "TokenInvalidError";
  }
}
export class TokenExpiredError extends Error {
  constructor() {
    super("Token expirado");
    this.name = "TokenExpiredError";
  }
}
export class TokenRevokedError extends Error {
  constructor() {
    super("Token revogado");
    this.name = "TokenRevokedError";
  }
}
export class TokenExhaustedError extends Error {
  constructor() {
    super("Token esgotado (sem usos disponíveis)");
    this.name = "TokenExhaustedError";
  }
}
export class TokenUnavailableError extends Error {
  constructor() {
    super("Token sem usos disponíveis no momento");
    this.name = "TokenUnavailableError";
  }
}

function rawCode(): string {
  const bytes = randomBytes(RAW_LEN);
  let out = "";
  for (let i = 0; i < RAW_LEN; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  const groups: string[] = [];
  for (let i = 0; i < GROUPS; i++) {
    groups.push(out.slice(i * GROUP_LEN, (i + 1) * GROUP_LEN));
  }
  return groups.join("-");
}

export function normalizeTokenCode(input: string): string {
  const cleaned = (input ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (cleaned.length !== RAW_LEN) return cleaned;
  const groups: string[] = [];
  for (let i = 0; i < GROUPS; i++) {
    groups.push(cleaned.slice(i * GROUP_LEN, (i + 1) * GROUP_LEN));
  }
  return groups.join("-");
}

export async function generateUniqueTokenCode(maxAttempts = 8): Promise<string> {
  for (let i = 0; i < maxAttempts; i++) {
    const code = rawCode();
    const existing = await prisma.accessToken.findUnique({ where: { code } });
    if (!existing) return code;
  }
  throw new Error("Não foi possível gerar um código único após múltiplas tentativas");
}

export type TokenStatus = "active" | "expired" | "revoked" | "exhausted";

export function deriveStatus(token: Pick<AccessToken, "revokedAt" | "expiresAt" | "usedCount" | "maxUses">): TokenStatus {
  if (token.revokedAt) return "revoked";
  if (token.expiresAt.getTime() <= Date.now()) return "expired";
  if (token.usedCount >= token.maxUses) return "exhausted";
  return "active";
}

export async function findTokenByCode(code: string): Promise<AccessToken | null> {
  const normalized = normalizeTokenCode(code);
  if (!normalized) return null;
  return prisma.accessToken.findUnique({ where: { code: normalized } });
}

export async function validateTokenForUse(code: string): Promise<AccessToken> {
  const token = await findTokenByCode(code);
  if (!token) throw new TokenInvalidError();
  if (token.revokedAt) throw new TokenRevokedError();
  if (token.expiresAt.getTime() <= Date.now()) throw new TokenExpiredError();
  if (token.usedCount >= token.maxUses) throw new TokenExhaustedError();
  return token;
}

/**
 * Reserva um uso do token de forma atômica via UPDATE condicional. SQLite não
 * suporta a Prisma "fields reference" (column-vs-column), então usamos raw SQL.
 * Se duas requisições competirem pelo último uso, apenas uma incrementará.
 */
export async function reserveTokenUse(tokenId: string): Promise<void> {
  const now = new Date();
  // Why: comparação coluna-vs-coluna (usedCount < maxUses) não é representável
  // via Prisma client no SQLite; raw SQL garante atomicidade no nível do banco.
  // Number() defende contra drivers que retornam bigint.
  const affected = await prisma.$executeRaw`
    UPDATE "AccessToken"
    SET "usedCount" = "usedCount" + 1
    WHERE "id" = ${tokenId}
      AND "revokedAt" IS NULL
      AND "expiresAt" > ${now}
      AND "usedCount" < "maxUses"
  `;
  if (Number(affected) === 0) throw new TokenUnavailableError();
}

export async function releaseTokenUse(tokenId: string): Promise<void> {
  await prisma.accessToken.updateMany({
    where: { id: tokenId, usedCount: { gt: 0 } },
    data: { usedCount: { decrement: 1 } },
  });
}
