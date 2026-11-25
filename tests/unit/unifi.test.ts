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
  for (const k of ["UNIFI_USERNAME", "UNIFI_PASSWORD", "UNIFI_API_KEY", "UNIFI_AUTH_MODE", "UNIFI_SITE", "UNIFI_CLIENT_WAIT_MS"]) {
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
    expect(await unifi.authorizeGuest(guestParams)).toEqual({ mac: "aa:bb:cc:dd:ee:ff", matchedBy: "mac" });

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

  it("revogar devolve o tráfego final da autorização (revokedAuthorization.usage)", async () => {
    await setup(opts, { UNIFI_API_KEY: "chave" });
    const usage = await unifi.unauthorizeGuest("AA:BB:CC:DD:EE:FF");
    expect(usage).toMatchObject({ mac: "aa:bb:cc:dd:ee:ff", rx_bytes: 2000, tx_bytes: 1000, authorized: false });
    expect(usage?.end).toBe(Date.parse("2026-09-26T11:00:05Z") / 1000);
  });

  it("revogar cliente já desconectado não chama a ação e devolve null", async () => {
    await setup(opts, { UNIFI_API_KEY: "chave" });
    expect(await unifi.unauthorizeGuest("aa:bb:cc:dd:ee:99")).toBeNull();
    expect(mock.callsTo("/actions")).toHaveLength(0);
  });

  it("espera o cliente recém-associado aparecer na API oficial", async () => {
    await setup(opts, { UNIFI_API_KEY: "chave", UNIFI_CLIENT_WAIT_MS: "5000" });
    mock.hideClientsForCalls = 2;
    await unifi.authorizeGuest(guestParams);
    expect(mock.callsTo("/actions")).toHaveLength(1);
  });

  it("cliente não listado vira UniFiClientNotFoundError quando não há fallback", async () => {
    await setup(opts, { UNIFI_API_KEY: "chave", UNIFI_CLIENT_WAIT_MS: "0" });
    mock.hideClientsForCalls = 100;
    await expect(unifi.authorizeGuest(guestParams)).rejects.toBeInstanceOf(unifi.UniFiClientNotFoundError);
    expect(mock.callsTo("/actions")).toHaveLength(0);
  });

  it("MAC velho na URL: libera na hora o guest conectado com o IP do pedido", async () => {
    await setup(opts, { UNIFI_API_KEY: "chave", UNIFI_CLIENT_WAIT_MS: "5000" });
    const started = Date.now();
    const res = await unifi.authorizeGuest({ ...guestParams, mac: "f2:bd:c9:01:c1:dd", clientIp: "10.0.0.10" });
    expect(res).toEqual({ mac: "aa:bb:cc:dd:ee:ff", matchedBy: "ip" });
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(mock.callsTo(`/clients/${MOCK_CLIENT_ID}/actions`)).toHaveLength(1);
  });

  it("o MAC informado tem precedência sobre o IP", async () => {
    await setup(opts, { UNIFI_API_KEY: "chave" });
    mock.guests.push({ mac: "aa:bb:cc:dd:ee:01", ip: "10.0.0.11", tx_bytes: 0, rx_bytes: 0, authorized: false });
    const res = await unifi.authorizeGuest({ ...guestParams, clientIp: "10.0.0.11" });
    expect(res).toEqual({ mac: "aa:bb:cc:dd:ee:ff", matchedBy: "mac" });
  });

  it("o IP nunca libera um cliente que não é guest", async () => {
    await setup(opts, { UNIFI_API_KEY: "chave", UNIFI_CLIENT_WAIT_MS: "0" });
    mock.guests[0].accessType = "DEFAULT";
    await expect(
      unifi.authorizeGuest({ ...guestParams, mac: "f2:bd:c9:01:c1:dd", clientIp: "10.0.0.10" }),
    ).rejects.toThrow(/nem há guest com o IP 10\.0\.0\.10/);
    expect(mock.callsTo("/actions")).toHaveLength(0);
  });

  it("guest achado pelo IP e recusado pelas regras do portal não é liberado", async () => {
    await setup(opts, { UNIFI_API_KEY: "chave", UNIFI_CLIENT_WAIT_MS: "0" });
    const allowIpMatch = vi.fn().mockResolvedValue(false);
    await expect(
      unifi.authorizeGuest({ ...guestParams, mac: "f2:bd:c9:01:c1:dd", clientIp: "10.0.0.10", allowIpMatch }),
    ).rejects.toBeInstanceOf(unifi.UniFiClientNotFoundError);
    expect(allowIpMatch).toHaveBeenCalledWith("aa:bb:cc:dd:ee:ff");
    expect(mock.callsTo("/actions")).toHaveLength(0);
  });

  it("cliente não listado na API oficial cai para a API legada por usuário/senha", async () => {
    await setup(
      { ...opts, username: "api", password: "pw" },
      { UNIFI_API_KEY: "chave", UNIFI_USERNAME: "api", UNIFI_PASSWORD: "pw", UNIFI_CLIENT_WAIT_MS: "0" },
    );
    mock.hideClientsForCalls = 100;
    await unifi.authorizeGuest(guestParams);
    expect(mock.callsTo("/actions")).toHaveLength(0);
    const cmd = mock.callsTo("/proxy/network/api/s/default/cmd/stamgr").at(-1);
    expect(cmd?.body).toMatchObject({ cmd: "authorize-guest", mac: "aa:bb:cc:dd:ee:ff" });
    // A API oficial continua disponível para o próximo guest.
    mock.hideClientsForCalls = 0;
    await unifi.authorizeGuest(guestParams);
    expect(mock.callsTo("/actions")).toHaveLength(1);
  });

  it("estatísticas preferem a API legada com API Key (tem contadores de tráfego)", async () => {
    await setup({ ...opts, legacyAcceptsApiKey: true }, { UNIFI_API_KEY: "chave" });
    const guests = await unifi.listActiveGuests();
    expect(guests[0].rx_bytes).toBe(2000);
    expect(mock.callsTo("/proxy/network/api/s/default/stat/guest")[0].headers["x-api-key"]).toBe("chave");
  });

  it("sem API legada por chave, lista guests pela API oficial com o filtro de guest (sem detalhes)", async () => {
    await setup(opts, { UNIFI_API_KEY: "chave" });
    const guests = await unifi.listActiveGuests();
    expect(guests).toEqual([
      expect.objectContaining({ mac: "aa:bb:cc:dd:ee:ff", ip: "10.0.0.10", authorized: true }),
    ]);
    expect(guests[0].tx_bytes).toBeUndefined();
    const list = mock.callsTo(`/v1/sites/${MOCK_SITE_ID}/clients?`)[0];
    expect(decodeURIComponent(list.path)).toContain("filter=access.type.eq('GUEST')");
    expect(mock.callsTo(`/clients/${MOCK_CLIENT_ID}`)).toHaveLength(0);
  });

  it("com withTraffic, lê os bytes em access.authorization.usage do detalhe do cliente", async () => {
    await setup(opts, { UNIFI_API_KEY: "chave" });
    const [g] = await unifi.listActiveGuests(null, { withTraffic: true });
    expect(g).toMatchObject({ mac: "aa:bb:cc:dd:ee:ff", rx_bytes: 2000, tx_bytes: 1000, authorized: true });
    expect(g.start).toBe(Date.parse("2026-09-26T10:00:05Z") / 1000);
    expect(g.end).toBe(Date.parse("2026-09-26T11:00:05Z") / 1000);
    expect(mock.callsTo(`/v1/sites/${MOCK_SITE_ID}/clients/${MOCK_CLIENT_ID}`)).toHaveLength(1);
  });

  it("guest não autorizado não gera consulta de detalhe", async () => {
    await setup(opts, { UNIFI_API_KEY: "chave" });
    mock.guests[0].authorized = false;
    const [g] = await unifi.listActiveGuests(null, { withTraffic: true });
    expect(g.authorized).toBe(false);
    expect(mock.callsTo(`/clients/${MOCK_CLIENT_ID}`)).toHaveLength(0);
  });

  it("detalhe 404 (guest saiu) não derruba a listagem nem tira a API oficial de uso", async () => {
    await setup(opts, { UNIFI_API_KEY: "chave" });
    mock.guests.push({ mac: "aa:bb:cc:dd:ee:01", ip: "10.0.0.11", tx_bytes: 10, rx_bytes: 20, authorized: true });
    mock.detailNotFound.add(MOCK_CLIENT_ID);
    const guests = await unifi.listActiveGuests(null, { withTraffic: true });
    expect(guests).toHaveLength(2);
    expect(guests[0].rx_bytes).toBeUndefined();
    expect(guests[1]).toMatchObject({ mac: "aa:bb:cc:dd:ee:01", rx_bytes: 20, tx_bytes: 10 });

    mock.detailNotFound.clear();
    const again = await unifi.listActiveGuests(null, { withTraffic: true });
    expect(again[0].rx_bytes).toBe(2000);
    expect(unifi.lastStatsStrategy()).toBe("integration");
  });

  it("sem suporte a filtro, varre a lista uma vez e memoriza a recusa", async () => {
    await setup({ ...opts, integrationFilter: false }, { UNIFI_API_KEY: "chave" });
    await unifi.listActiveGuests();
    await unifi.listActiveGuests();
    expect(mock.callsTo("filter=")).toHaveLength(1);
  });

  it("ajusta limites fora da faixa aceita pela API oficial em vez de falhar a liberação", async () => {
    await setup(opts, { UNIFI_API_KEY: "chave" });
    await unifi.authorizeGuest({ ...guestParams, downKbps: 250_000, upKbps: 1, bytesQuotaMB: 5_000_000 });
    expect(mock.callsTo("/actions")[0].body).toEqual({
      action: "AUTHORIZE_GUEST_ACCESS",
      timeLimitMinutes: 60,
      rxRateLimitKbps: 100_000,
      txRateLimitKbps: 2,
      dataUsageLimitMBytes: 1_048_576,
    });
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

describe("revogação pela API legada", () => {
  it("devolve null (o /stat/guest mantém a sessão encerrada para a reconciliação)", async () => {
    await setup({ variant: "classic", username: "api", password: "pw" }, { UNIFI_USERNAME: "api", UNIFI_PASSWORD: "pw" });
    expect(await unifi.unauthorizeGuest("aa:bb:cc:dd:ee:ff")).toBeNull();
    expect(mock.callsTo("/api/s/default/cmd/stamgr")[0].body).toEqual({ cmd: "unauthorize-guest", mac: "aa:bb:cc:dd:ee:ff" });
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
