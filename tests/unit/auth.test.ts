import { describe, expect, it } from "vitest";
import {
  checkAdminPassword,
  createMfaToken,
  createSessionToken,
  verifyMfaToken,
  verifySessionToken,
} from "@/lib/auth";

const payload = { uid: "u1", u: "maria", r: "operator" as const, v: 3 };

describe("sessão admin (v2)", () => {
  it("assina e valida token com identidade e papel", async () => {
    const token = await createSessionToken(payload);
    expect(await verifySessionToken(token)).toMatchObject(payload);
  });

  it("rejeita token adulterado, de outro tipo ou ausente", async () => {
    const token = await createSessionToken(payload);
    const [kind, body, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...payload, r: "admin", iat: Date.now() })).toString("base64url");
    expect(await verifySessionToken(`${kind}.${forged}.${sig}`)).toBeNull();
    expect(await verifySessionToken(`${kind}.${body}.${"0".repeat(64)}`)).toBeNull();
    expect(await verifySessionToken(await createMfaToken("u1"))).toBeNull();
    expect(await verifySessionToken(undefined)).toBeNull();
    expect(await verifySessionToken("lixo")).toBeNull();
  });

  it("token de MFA carrega só o uid e não serve como sessão", async () => {
    const mfa = await createMfaToken("u9");
    expect(await verifyMfaToken(mfa)).toBe("u9");
    expect(await verifyMfaToken(await createSessionToken(payload))).toBeNull();
  });

  it("compara senha legada do admin", async () => {
    process.env.ADMIN_PASSWORD = "segredo";
    expect(await checkAdminPassword("segredo")).toBe(true);
    expect(await checkAdminPassword("errado")).toBe(false);
  });
});
