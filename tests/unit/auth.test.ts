import { describe, expect, it } from "vitest";
import { checkAdminPassword, createSessionToken, verifySessionToken } from "@/lib/auth";

describe("sessão admin", () => {
  it("assina e valida token de sessão", async () => {
    const token = await createSessionToken();
    expect(await verifySessionToken(token)).toBe(true);
  });

  it("rejeita token adulterado ou ausente", async () => {
    const token = await createSessionToken();
    const [ts, sig] = token.split(".");
    expect(await verifySessionToken(`${Number(ts) + 1}.${sig}`)).toBe(false);
    expect(await verifySessionToken(undefined)).toBe(false);
    expect(await verifySessionToken("lixo")).toBe(false);
  });

  it("compara senha do admin", async () => {
    process.env.ADMIN_PASSWORD = "segredo";
    expect(await checkAdminPassword("segredo")).toBe(true);
    expect(await checkAdminPassword("errado")).toBe(false);
  });
});
