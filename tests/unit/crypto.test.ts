import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, isEncryptedSecret } from "@/lib/crypto";

describe("encryptSecret / decryptSecret", () => {
  it("faz round-trip com IV aleatório", () => {
    const a = encryptSecret("senha-da-controladora");
    const b = encryptSecret("senha-da-controladora");
    expect(a).not.toBe(b);
    expect(isEncryptedSecret(a)).toBe(true);
    expect(decryptSecret(a)).toBe("senha-da-controladora");
  });

  it("detecta adulteração (GCM)", () => {
    const enc = encryptSecret("x");
    const parts = enc.split(":");
    parts[4] = Buffer.from("y").toString("base64");
    expect(() => decryptSecret(parts.join(":"))).toThrow();
  });

  it("usa DATA_ENCRYPTION_KEY quando definida", () => {
    const enc = encryptSecret("abc");
    process.env.DATA_ENCRYPTION_KEY = "a".repeat(64);
    try {
      expect(() => decryptSecret(enc)).toThrow();
      expect(decryptSecret(encryptSecret("abc"))).toBe("abc");
    } finally {
      delete process.env.DATA_ENCRYPTION_KEY;
    }
  });
});
