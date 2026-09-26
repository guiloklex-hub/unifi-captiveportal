import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MOCK_CLIENT_ID, MOCK_SITE_ID, MockUnifi, type MockOptions } from "../helpers/mockUnifi";

vi.mock("@/lib/prisma", () => ({
  prisma: { uniFiConnection: { findUnique: vi.fn().mockResolvedValue(null) } },
}));

const unifi = await import("@/lib/unifi");
const { invalidateUniFiConfigCache } = await import("@/lib/unifi/config");
const { resetCircuit } = await import("@/lib/unifi/http");

let mock: MockUnifi;

async function setup(opts: MockOptions, env: Record<string, string | undefined>) {
  mock = new MockUnifi(opts);
  const url = await mock.start();
  for (const k of ["UNIFI_USERNAME", "UNIFI_PASSWORD", "UNIFI_API_KEY", "UNIFI_AUTH_MODE", "UNIFI_SITE"]) {
    delete process.env[k];
  }
  process.env.UNIFI_URL = url;
  Object.assign(process.env, env);
  invalidateUniFiConfigCache();
  unifi.clearUniFiSession();
  resetCircuit();
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(async () => {
  await mock?.stop();
});

const guestParams = { mac: "AA:BB:CC:DD:EE:FF", minutes: 60, downKbps: 5120, upKbps: 1024, bytesQuotaMB: 500 };

describe("Classic (self-hosted) com usuário/senha", () => {
  it("autoriza via /api/login + cmd/stamgr com os limites", async () => {
    await setup({ variant: "classic", username: "api", password: "pw" }, { UNIFI_USERNAME: "api", UNIFI_PASSWORD: "pw" });
    await unifi.authorizeGuest({ ...guestParams, apMac: "11:22:33:44:55:66" });

    expect(mock.callsTo("/api/login")).toHaveLength(1);
    const cmd = mock.callsTo("/api/s/default/cmd/stamgr")[0];
    expect(cmd.body).toEqual({
      cmd: "authorize-guest",
      mac: "aa:bb:cc:dd:ee:ff",
      minutes: 60,
      down: 5120,
      up: 1024,
      bytes: 500,
      ap_mac: "11:22:33:44:55:66",
    });
  });

  it("reaproveita a sessão e reloga quando ela expira", async () => {
    await setup({ variant: "classic", username: "api", password: "pw" }, { UNIFI_USERNAME: "api", UNIFI_PASSWORD: "pw" });
    await unifi.listActiveGuests();
    await unifi.listActiveGuests();
    expect(mock.callsTo("/api/login")).toHaveLength(1);

    mock.expireSessionOnce = true;
    const guests = await unifi.listActiveGuests();
    expect(guests[0].tx_bytes).toBe(1000);
    expect(mock.callsTo("/api/login")).toHaveLength(2);
  });

  it("usa o site informado e recusa nomes de site maliciosos", async () => {
    await setup({ variant: "classic", username: "api", password: "pw" }, { UNIFI_USERNAME: "api", UNIFI_PASSWORD: "pw" });
    await unifi.unauthorizeGuest("aa:bb:cc:dd:ee:ff", "evento");
    expect(mock.callsTo("/api/s/evento/cmd/stamgr")).toHaveLength(1);
    await expect(unifi.authorizeGuest({ ...guestParams, site: "../cmd/devmgr" })).rejects.toBeInstanceOf(
      unifi.UniFiClientError,
    );
  });

  it("senha errada vira UniFiAuthError", async () => {
    await setup({ variant: "classic", username: "api", password: "pw" }, { UNIFI_USERNAME: "api", UNIFI_PASSWORD: "errada" });
    await expect(unifi.authorizeGuest(guestParams)).rejects.toBeInstanceOf(unifi.UniFiAuthError);
  });

  it("API Key numa controladora Classic não funciona e cai para usuário/senha (modo auto)", async () => {
    await setup(
      { variant: "classic", username: "api", password: "pw", apiKey: "k" },
      { UNIFI_API_KEY: "k", UNIFI_USERNAME: "api", UNIFI_PASSWORD: "pw" },
    );
    await unifi.authorizeGuest(guestParams);
    expect(mock.callsTo("/api/s/default/cmd/stamgr")).toHaveLength(1);
    expect(mock.callsTo("/api/login")).toHaveLength(1);
  });
});

describe("UniFi OS com API Key (API oficial)", () => {
  const opts: MockOptions = { variant: "unifi-os", apiKey: "chave", integration: true, integrationFilter: true };

  it("autoriza pela Integration API sem nenhum login", async () => {
    await setup(opts, { UNIFI_API_KEY: "chave" });
    await unifi.authorizeGuest(guestParams);

    expect(mock.callsTo("/api/auth/login")).toHaveLength(0);
    const action = mock.callsTo(`/v1/sites/${MOCK_SITE_ID}/clients/${MOCK_CLIENT_ID}/actions`)[0];
    expect(action.headers["x-api-key"]).toBe("chave");
    expect(action.body).toEqual({
      action: "AUTHORIZE_GUEST_ACCESS",
      timeLimitMinutes: 60,
      rxRateLimitKbps: 5120,
      txRateLimitKbps: 1024,
      dataUsageLimitMBytes: 500,
    });
  });

  it("encontra o cliente varrendo a lista quando o filtro não é suportado", async () => {
    await setup({ ...opts, integrationFilter: false }, { UNIFI_API_KEY: "chave" });
    await unifi.unauthorizeGuest("aa:bb:cc:dd:ee:ff");
    const action = mock.callsTo("/actions")[0];
    expect(action.body).toEqual({ action: "UNAUTHORIZE_GUEST_ACCESS" });
  });

  it("estatísticas preferem a API legada com API Key (tem contadores de tráfego)", async () => {
    await setup({ ...opts, legacyAcceptsApiKey: true }, { UNIFI_API_KEY: "chave" });
    const guests = await unifi.listActiveGuests();
    expect(guests[0].rx_bytes).toBe(2000);
    expect(mock.callsTo("/proxy/network/api/s/default/stat/guest")[0].headers["x-api-key"]).toBe("chave");
  });

  it("sem API legada por chave, lista guests pela API oficial (sem bytes)", async () => {
    await setup(opts, { UNIFI_API_KEY: "chave" });
    const guests = await unifi.listActiveGuests();
    expect(guests).toEqual([
      expect.objectContaining({ mac: "aa:bb:cc:dd:ee:ff", ip: "10.0.0.10", authorized: true }),
    ]);
    expect(guests[0].tx_bytes).toBeUndefined();
  });

  it("chave inválida cai para usuário/senha no modo auto", async () => {
    await setup(
      { ...opts, username: "api", password: "pw" },
      { UNIFI_API_KEY: "errada", UNIFI_USERNAME: "api", UNIFI_PASSWORD: "pw" },
    );
    await unifi.authorizeGuest(guestParams);
    expect(mock.callsTo("/api/auth/login")).toHaveLength(1);
    // A tentativa com a chave errada é recusada; a que passa usa o cookie da sessão.
    const cmds = mock.callsTo("/proxy/network/api/s/default/cmd/stamgr");
    expect(cmds.at(-1)?.headers.cookie).toMatch(/TOKEN=/);
  });

  it("modo apikey nunca usa usuário/senha", async () => {
    await setup(
      { ...opts, username: "api", password: "pw" },
      { UNIFI_API_KEY: "errada", UNIFI_USERNAME: "api", UNIFI_PASSWORD: "pw", UNIFI_AUTH_MODE: "apikey" },
    );
    await expect(unifi.authorizeGuest(guestParams)).rejects.toBeInstanceOf(unifi.UniFiAuthError);
    expect(mock.callsTo("/api/auth/login")).toHaveLength(0);
  });

  it("modo password ignora a API Key", async () => {
    await setup(
      { ...opts, username: "api", password: "pw" },
      { UNIFI_API_KEY: "chave", UNIFI_USERNAME: "api", UNIFI_PASSWORD: "pw", UNIFI_AUTH_MODE: "password" },
    );
    await unifi.authorizeGuest(guestParams);
    expect(mock.callsTo("/integration/")).toHaveLength(0);
    expect(mock.callsTo("/api/auth/login")).toHaveLength(1);
  });
});

describe("UniFi OS sem API oficial (Network < 9.3)", () => {
  it("usa a API legada com API Key", async () => {
    await setup({ variant: "unifi-os", apiKey: "chave", legacyAcceptsApiKey: true }, { UNIFI_API_KEY: "chave" });
    await unifi.authorizeGuest(guestParams);
    const cmd = mock.callsTo("/proxy/network/api/s/default/cmd/stamgr")[0];
    expect(cmd.headers["x-api-key"]).toBe("chave");
    expect(mock.callsTo("/api/auth/login")).toHaveLength(0);
  });
});

describe("findClientMacByIp", () => {
  it("encontra o MAC pela API legada", async () => {
    await setup({ variant: "classic", username: "api", password: "pw" }, { UNIFI_USERNAME: "api", UNIFI_PASSWORD: "pw" });
    expect(await unifi.findClientMacByIp("10.0.0.10")).toBe("aa:bb:cc:dd:ee:ff");
    expect(await unifi.findClientMacByIp("10.0.0.99")).toBeNull();
  });

  it("encontra o MAC pela API oficial", async () => {
    await setup({ variant: "unifi-os", apiKey: "chave", integration: true }, { UNIFI_API_KEY: "chave" });
    expect(await unifi.findClientMacByIp("10.0.0.10")).toBe("aa:bb:cc:dd:ee:ff");
  });
});

describe("diagnoseUniFi", () => {
  it("reporta variante, versão, sites e estratégia ativa", async () => {
    await setup(
      { variant: "unifi-os", apiKey: "chave", integration: true, integrationFilter: true, username: "api", password: "pw", version: "9.5.1" },
      { UNIFI_API_KEY: "chave", UNIFI_USERNAME: "api", UNIFI_PASSWORD: "pw" },
    );
    const d = await unifi.diagnoseUniFi();
    expect(d.variant).toBe("unifi-os");
    expect(d.version).toBe("9.5.1");
    expect(d.activeStrategy).toBe("integration");
    expect(d.sites[0]).toMatchObject({ name: "default", id: MOCK_SITE_ID });
    const byName = Object.fromEntries(d.strategies.map((s) => [s.strategy, s]));
    expect(byName.integration.ok).toBe(true);
    expect(byName["legacy-apikey"].ok).toBe(false);
    expect(byName["legacy-session"].ok).toBe(true);
  });

  it("marca Classic e explica que API Key não se aplica", async () => {
    await setup(
      { variant: "classic", username: "api", password: "pw" },
      { UNIFI_API_KEY: "k", UNIFI_USERNAME: "api", UNIFI_PASSWORD: "pw" },
    );
    const d = await unifi.diagnoseUniFi();
    expect(d.variant).toBe("classic");
    expect(d.version).toBe("10.1.89");
    expect(d.activeStrategy).toBe("legacy-session");
    expect(d.strategies.find((s) => s.strategy === "legacy-apikey")?.error).toMatch(/UniFi OS/);
  });
});

describe("controladora fora do ar", () => {
  it("lança UniFiUnavailableError após as tentativas", async () => {
    await setup({ variant: "classic", username: "api", password: "pw" }, { UNIFI_USERNAME: "api", UNIFI_PASSWORD: "pw" });
    await mock.stop();
    process.env.UNIFI_URL = "http://127.0.0.1:9";
    invalidateUniFiConfigCache();
    await expect(unifi.listActiveGuests()).rejects.toBeInstanceOf(unifi.UniFiUnavailableError);
  }, 15_000);

  it("sem nenhuma credencial lança UniFiNotConfiguredError", async () => {
    await setup({ variant: "classic" }, {});
    await expect(unifi.listActiveGuests()).rejects.toBeInstanceOf(unifi.UniFiNotConfiguredError);
  });
});

describe("teste de rascunho no painel", () => {
  it("URL errada não abre o circuit breaker usado pelos guests", async () => {
    await setup({ variant: "classic", username: "api", password: "pw" }, { UNIFI_USERNAME: "api", UNIFI_PASSWORD: "pw" });
    const { circuitState } = await import("@/lib/unifi/http");
    const draft = {
      url: "http://127.0.0.1:9",
      site: "default",
      authMode: "password" as const,
      username: "api",
      password: "pw",
      insecureTls: false,
      source: "db" as const,
      version: "draft:1",
      diagnostic: true,
    };
    for (let i = 0; i < 6; i++) {
      const d = await unifi.diagnoseUniFi(draft);
      expect(d.activeStrategy).toBeNull();
    }
    expect(circuitState().openUntil).toBeNull();
    // A configuração real continua funcionando.
    await unifi.authorizeGuest(guestParams);
  }, 60_000);
});
