import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const { deriveStatus, normalizeTokenCode } = await import("@/lib/tokens");
const { applyLocksToCreateInput } = await import("@/lib/tokenLocks");

describe("normalizeTokenCode", () => {
  it("agrupa código de 12 caracteres em XXXX-XXXX-XXXX", () => {
    expect(normalizeTokenCode("abcd efgh-jkmn")).toBe("ABCD-EFGH-JKMN");
  });

  it("devolve o texto limpo quando o tamanho não bate", () => {
    expect(normalizeTokenCode("abc")).toBe("ABC");
  });
});

describe("deriveStatus", () => {
  const base = {
    revokedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    usedCount: 0,
    maxUses: 1,
  };

  it("prioriza revogado > expirado > esgotado", () => {
    expect(deriveStatus(base)).toBe("active");
    expect(deriveStatus({ ...base, usedCount: 1 })).toBe("exhausted");
    expect(deriveStatus({ ...base, expiresAt: new Date(0), usedCount: 1 })).toBe("expired");
    expect(deriveStatus({ ...base, revokedAt: new Date(), expiresAt: new Date(0) })).toBe("revoked");
  });
});

describe("applyLocksToCreateInput", () => {
  it("sobrescreve campos travados e trata 0 como sem limite", () => {
    const input = {
      durationMin: 60,
      maxUses: 5,
      downKbps: 1000,
      upKbps: 500,
      bytesQuotaMB: 100,
      expiresAt: new Date(0),
    };
    const out = applyLocksToCreateInput(input, { durationMin: 30, downKbps: 0, expiresInMin: 10 });
    expect(out.durationMin).toBe(30);
    expect(out.downKbps).toBeUndefined();
    expect(out.upKbps).toBe(500);
    expect(out.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});
