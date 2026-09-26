import { describe, expect, it } from "vitest";
import { hashPassword, passwordPolicyError, verifyPassword } from "@/lib/admin/password";
import { base32Decode, base32Encode, hotp, totp, verifyTotp, generateTotpSecret, otpauthUrl } from "@/lib/admin/totp";
import { requiredRole, roleAllows } from "@/lib/admin/rbac";
import { normalizeRuleValue } from "@/lib/portal/accessRules";

describe("senhas (scrypt)", () => {
  it("hash com sal aleatório e verificação", async () => {
    const a = await hashPassword("Senha-forte-123");
    const b = await hashPassword("Senha-forte-123");
    expect(a).not.toBe(b);
    expect(a.startsWith("scrypt$16384$8$1$")).toBe(true);
    expect(await verifyPassword("Senha-forte-123", a)).toBe(true);
    expect(await verifyPassword("errada", a)).toBe(false);
    expect(await verifyPassword("x", "formato-invalido")).toBe(false);
  });

  it("política mínima", () => {
    expect(passwordPolicyError("curta1")).toMatch(/10/);
    expect(passwordPolicyError("somenteletras")).toMatch(/letras e números/);
    expect(passwordPolicyError("letras123456")).toBeNull();
  });
});

describe("TOTP (RFC 6238)", () => {
  // Vetor de teste da RFC 4226/6238: segredo ASCII "12345678901234567890".
  const secret = base32Encode(Buffer.from("12345678901234567890"));

  it("base32 ida e volta", () => {
    expect(base32Decode(secret).toString()).toBe("12345678901234567890");
  });

  it("confere vetores oficiais", () => {
    expect(hotp(secret, 0)).toBe("755224");
    expect(hotp(secret, 1)).toBe("287082");
    expect(totp(secret, 59_000)).toBe("287082");
    expect(totp(secret, 1111111109_000)).toBe("081804");
  });

  it("aceita ±1 passo e recusa códigos fora da janela", () => {
    const now = 1_700_000_000_000;
    expect(verifyTotp(secret, totp(secret, now - 30_000), now)).toBe(true);
    expect(verifyTotp(secret, totp(secret, now + 30_000), now)).toBe(true);
    expect(verifyTotp(secret, totp(secret, now - 90_000), now)).toBe(false);
    expect(verifyTotp(secret, "12345", now)).toBe(false);
  });

  it("gera segredo e URL otpauth", () => {
    const s = generateTotpSecret();
    expect(s).toMatch(/^[A-Z2-7]{32}$/);
    expect(otpauthUrl(s, "maria", "Hotel X")).toMatch(/^otpauth:\/\/totp\/Hotel%20X%3Amaria\?secret=/);
  });
});

describe("RBAC", () => {
  it("áreas exclusivas de admin", () => {
    expect(requiredRole("/admin/users", "GET")).toBe("admin");
    expect(requiredRole("/api/admin/unifi/test", "POST")).toBe("admin");
    expect(requiredRole("/api/admin/settings", "GET")).toBe("admin");
  });

  it("operador pode mutar a operação; leitura só GET", () => {
    expect(requiredRole("/api/admin/tokens", "POST")).toBe("operator");
    expect(requiredRole("/api/admin/tokens", "GET")).toBe("viewer");
    expect(roleAllows("viewer", "operator")).toBe(false);
    expect(roleAllows("operator", "operator")).toBe(true);
    expect(roleAllows("operator", "admin")).toBe(false);
  });

  it("conta própria é autoatendimento para qualquer papel", () => {
    expect(requiredRole("/api/admin/account/password", "POST")).toBe("viewer");
  });
});

describe("normalizeRuleValue", () => {
  it("normaliza cada tipo", () => {
    expect(normalizeRuleValue("mac", "AA-BB-CC-DD-EE-FF")).toBe("aa:bb:cc:dd:ee:ff");
    expect(normalizeRuleValue("cpf", "529.982.247-25")).toBe("52998224725");
    expect(normalizeRuleValue("email", " Ana@X.com ")).toBe("ana@x.com");
    expect(normalizeRuleValue("document", "ab-123 456")).toBe("AB123456");
  });
});
