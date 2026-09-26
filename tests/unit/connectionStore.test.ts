import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown> | null;
const db: { row: Row } = { row: null };

vi.mock("@/lib/prisma", () => ({
  prisma: {
    uniFiConnection: {
      findUnique: vi.fn(async () => (db.row ? { ...db.row, updatedAt: new Date() } : null)),
      upsert: vi.fn(async ({ create }: { create: Record<string, unknown> }) => {
        db.row = create;
        return create;
      }),
      deleteMany: vi.fn(async () => {
        db.row = null;
        return { count: 1 };
      }),
    },
  },
}));

const store = await import("@/lib/unifi/connectionStore");
const { getUniFiConfig, invalidateUniFiConfigCache } = await import("@/lib/unifi/config");

const base = { url: "https://10.0.0.1/", site: "default", insecureTls: true };

beforeEach(() => {
  db.row = null;
  process.env.UNIFI_URL = "https://env.local:8443";
  process.env.UNIFI_USERNAME = "env-user";
  process.env.UNIFI_PASSWORD = "env-pass";
  delete process.env.UNIFI_API_KEY;
  invalidateUniFiConfigCache();
});

describe("connectionStore", () => {
  it("sem registro no banco usa o .env", async () => {
    const view = await store.getConnectionView();
    expect(view).toMatchObject({ source: "env", url: "https://env.local:8443", hasPassword: true, hasApiKey: false });
  });

  it("salva cifrado, nunca devolve segredos e passa a ter precedência", async () => {
    await store.saveConnection(store.connectionInputSchema.parse({ ...base, authMode: "auto", apiKey: "k-123", username: "u", password: "p" }));
    expect(String(db.row?.apiKeyEnc)).toMatch(/^enc:v1:/);
    expect(String(db.row?.passwordEnc)).toMatch(/^enc:v1:/);
    const view = await store.getConnectionView();
    expect(view).toEqual({
      source: "db",
      url: "https://10.0.0.1",
      site: "default",
      authMode: "auto",
      username: "u",
      hasPassword: true,
      hasApiKey: true,
      insecureTls: true,
    });
    const cfg = await getUniFiConfig();
    expect(cfg.apiKey).toBe("k-123");
    expect(cfg.password).toBe("p");
  });

  it("modo apikey não grava senha, nem a herdada do .env", async () => {
    await store.saveConnection(store.connectionInputSchema.parse({ ...base, authMode: "apikey", apiKey: "k" }));
    expect(db.row?.passwordEnc).toBeNull();
    expect(db.row?.username).toBeNull();
  });

  it("campo de segredo em branco mantém o valor salvo; clear remove", async () => {
    await store.saveConnection(store.connectionInputSchema.parse({ ...base, authMode: "auto", apiKey: "k1" }));
    await store.saveConnection(store.connectionInputSchema.parse({ ...base, authMode: "auto", apiKey: "" }));
    expect((await getUniFiConfig()).apiKey).toBe("k1");
    await store.saveConnection(store.connectionInputSchema.parse({ ...base, authMode: "auto", clearApiKey: true }));
    expect(db.row?.apiKeyEnc).toBeNull();
  });

  it("reset volta para o .env", async () => {
    await store.saveConnection(store.connectionInputSchema.parse({ ...base, authMode: "auto", apiKey: "k" }));
    await store.resetConnection();
    expect((await store.getConnectionView()).source).toBe("env");
  });

  it("valida URL e site", () => {
    expect(store.connectionInputSchema.safeParse({ ...base, url: "ftp://x" }).success).toBe(false);
    expect(store.connectionInputSchema.safeParse({ ...base, site: "a/b" }).success).toBe(false);
  });
});
