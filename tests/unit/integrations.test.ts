import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { createHmac } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const keys = new Map<string, Record<string, unknown>>();
const prismaMock = {
  webhook: { update: vi.fn(async () => ({})), findMany: vi.fn(async () => []) },
  apiKey: {
    findUnique: vi.fn(async ({ where }: { where: { prefix: string } }) => keys.get(where.prefix) ?? null),
    update: vi.fn(async () => ({})),
  },
  guestRegistration: { findMany: vi.fn(async () => []) },
  auditLog: { create: vi.fn(async () => ({})) },
};
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const { encryptSecret } = await import("@/lib/crypto");
const webhooks = await import("@/lib/integrations/webhooks");
const apiKeys = await import("@/lib/integrations/apiKeys");
const reports = await import("@/lib/integrations/reports");
const { DEFAULT_SETTINGS } = await import("@/lib/settings");
const registrations = await import("@/app/api/v1/registrations/route");

// ── Receptor de webhooks ──────────────────────────────────────────────────
type Received = { headers: IncomingMessage["headers"]; body: string };
const received: Received[] = [];
let status = 200;
const server = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    received.push({ headers: req.headers, body });
    res.writeHead(status);
    res.end();
  });
});
let url = "";
beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
});
afterAll(() => server.close());
beforeEach(() => {
  received.length = 0;
  status = 200;
  keys.clear();
  vi.clearAllMocks();
});

describe("webhooks", () => {
  const secret = "whsec_teste";
  const target = () => ({ id: "w1", url, secretEnc: encryptSecret(secret), includePii: false });

  it("assina o corpo com HMAC-SHA256 e envia cabeçalhos do evento", async () => {
    const result = await webhooks.deliverWithRetry(target(), "guest.authorized", {
      data: { mac: "aa:bb" },
      pii: { email: "a@b.c" },
    });
    expect(result).toEqual({ status: 200, error: null });
    const [{ headers, body }] = received;
    expect(headers["x-portal-event"]).toBe("guest.authorized");
    const expected = createHmac("sha256", secret).update(`${headers["x-portal-timestamp"]}.${body}`).digest("hex");
    expect(headers["x-portal-signature"]).toBe(`sha256=${expected}`);
    const payload = JSON.parse(body);
    expect(payload.data).toEqual({ mac: "aa:bb" }); // sem PII por padrão
    expect(payload.id).toBe(headers["x-portal-delivery"]);
  });

  it("inclui dados pessoais só quando configurado", async () => {
    await webhooks.deliverWithRetry({ ...target(), includePii: true }, "guest.authorized", {
      data: { mac: "aa:bb" },
      pii: { email: "a@b.c" },
    });
    expect(JSON.parse(received[0].body).data).toEqual({ mac: "aa:bb", email: "a@b.c" });
  });

  it("não repete em erro 4xx e registra o status", async () => {
    status = 410;
    const result = await webhooks.deliverWithRetry(target(), "guest.revoked", { data: {} });
    expect(result).toEqual({ status: 410, error: "HTTP 410" });
    expect(received).toHaveLength(1);
    expect(prismaMock.webhook.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ lastStatus: 410, lastError: "HTTP 410" }) }),
    );
  });
});

describe("chaves de API", () => {
  function register(scopes: string) {
    const { key, prefix, hash } = apiKeys.generateApiKey();
    keys.set(prefix, { id: `k-${prefix}`, name: "BI", prefix, hash, scopes, revokedAt: null, lastUsedAt: null });
    return key;
  }

  it("autentica pelo hash e recusa chave errada/revogada", async () => {
    const key = register("read");
    expect(key).toMatch(/^ucp_[0-9a-f]{12}_/);
    expect(await apiKeys.authenticateApiKey(`Bearer ${key}`)).toMatchObject({ name: "BI", scopes: ["read"] });
    expect(await apiKeys.authenticateApiKey(`Bearer ${key}x`)).toBeNull();
    expect(await apiKeys.authenticateApiKey("Bearer lixo")).toBeNull();
    const prefix = key.split("_")[1];
    keys.get(prefix)!.revokedAt = new Date();
    expect(await apiKeys.authenticateApiKey(`Bearer ${key}`)).toBeNull();
  });

  const get = (key?: string) =>
    new NextRequest("http://portal.local/api/v1/registrations", { headers: key ? { authorization: `Bearer ${key}` } : {} });

  it("registros: 401 sem chave, sem PII com 'read', com PII em 'read:pii'", async () => {
    prismaMock.guestRegistration.findMany.mockResolvedValue([
      {
        id: 1,
        authorizedAt: new Date(),
        macAddress: "aa",
        ipAddress: null,
        site: null,
        ssid: null,
        apMac: null,
        authMethod: "form",
        durationMin: 60,
        bytesTx: null,
        bytesRx: null,
        token: null,
        marketingConsent: false,
        anonymizedAt: null,
        fullName: "Ana",
        email: "a@b.c",
        phone: "",
        cpf: "529",
        documentType: null,
        document: null,
      },
    ] as never);
    expect((await registrations.GET(get())).status).toBe(401);
    const plain = await (await registrations.GET(get(register("read")))).json();
    expect(plain.data[0].email).toBeUndefined();
    const pii = await (await registrations.GET(get(register("read:pii")))).json();
    expect(pii.data[0]).toMatchObject({ email: "a@b.c", fullName: "Ana" });
  });

  it("escopo write não dá leitura", async () => {
    expect((await registrations.GET(get(register("write")))).status).toBe(403);
  });
});

describe("relatório por e-mail", () => {
  it("dia de envio: diário sempre; semanal só às segundas (BRT)", () => {
    expect(reports.isReportDay("daily")).toBe(true);
    expect(reports.isReportDay("off")).toBe(false);
    expect(reports.isReportDay("weekly", new Date("2026-09-28T12:00:00Z"))).toBe(true); // segunda
    expect(reports.isReportDay("weekly", new Date("2026-09-29T12:00:00Z"))).toBe(false);
  });

  it("filtra destinatários inválidos", () => {
    expect(reports.recipientsOf({ ...DEFAULT_SETTINGS, reportRecipients: "a@b.com, x; c@d.org" })).toEqual(["a@b.com", "c@d.org"]);
  });

  it("renderiza HTML escapado", () => {
    const { html, subject } = reports.renderReport("<Hotel>", "26/09/2026", {
      from: "",
      to: "",
      connections: 10,
      uniqueVisitors: 8,
      newVisitors: 3,
      marketingConsents: 2,
      bytesTotal: 1024,
      byDay: [],
      byMethod: { form: 7, token: 3 },
      bySite: { default: 10 },
    });
    expect(subject).toContain("<Hotel>");
    expect(html).toContain("&lt;Hotel&gt;");
    expect(html).toContain("Formulário");
  });
});
